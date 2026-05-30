//! UPnP port forwarding manager for remote access.
//!
//! Discovers the local gateway via UPnP/IGD, adds a TCP port mapping so the
//! server is reachable from the public internet, and periodically renews the
//! lease before it expires.

use igd_next::aio::tokio as igd_tokio;
use igd_next::{PortMappingProtocol, SearchOptions};
use serde::Serialize;
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};

/// How long (in seconds) the UPnP lease is requested for.
/// We renew well before this expires via the scheduler.
const LEASE_DURATION_SECONDS: u32 = 3600;

/// Human-readable description shown on the router's port mapping table.
const PORT_MAPPING_DESCRIPTION: &str = "Ironshelf Server";

/// Snapshot of the UPnP manager's current state, returned via the API.
#[derive(Debug, Clone, Serialize)]
pub struct UpnpStatus {
    pub is_enabled: bool,
    pub is_active: bool,
    pub public_url: Option<String>,
    pub public_ip: Option<String>,
    pub external_port: u16,
    pub internal_port: u16,
    pub last_error: Option<String>,
}

/// Manages a single UPnP/IGD port mapping for the Ironshelf server.
pub struct UpnpManager {
    gateway: Option<igd_tokio::Gateway>,
    external_port: u16,
    internal_port: u16,
    public_ip: Option<String>,
    local_ip: Option<Ipv4Addr>,
    is_enabled: bool,
    is_active: bool,
    last_error: Option<String>,
}

/// Determine the local IPv4 address by opening a UDP socket toward the
/// gateway. The OS picks the correct source interface without actually
/// sending any traffic.
fn detect_local_ipv4(gateway_address: &std::net::SocketAddr) -> Result<Ipv4Addr, String> {
    let target = match gateway_address {
        std::net::SocketAddr::V4(socket_v4) => *socket_v4,
        std::net::SocketAddr::V6(_) => {
            return Err("IPv6 gateway not supported for UPnP".to_string());
        }
    };

    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|bind_error| format!("Failed to bind UDP socket: {bind_error}"))?;

    socket
        .connect(target)
        .map_err(|connect_error| format!("Failed to connect UDP socket to gateway: {connect_error}"))?;

    let local_address = socket
        .local_addr()
        .map_err(|address_error| format!("Failed to get local address: {address_error}"))?;

    match local_address {
        std::net::SocketAddr::V4(socket_v4) => Ok(*socket_v4.ip()),
        std::net::SocketAddr::V6(_) => Err("Unexpected IPv6 local address".to_string()),
    }
}

impl UpnpManager {
    /// Create a new manager. Does NOT discover the gateway or add any mapping
    /// until [`enable`] is called.
    pub fn new(internal_port: u16, external_port: u16) -> Self {
        Self {
            gateway: None,
            external_port,
            internal_port,
            public_ip: None,
            local_ip: None,
            is_enabled: false,
            is_active: false,
            last_error: None,
        }
    }

    /// Discover the gateway, add a TCP port mapping, and return the public URL
    /// on success (e.g. `http://203.0.113.45:10810`).
    pub async fn enable(&mut self) -> Result<String, String> {
        self.is_enabled = true;
        self.last_error = None;

        // 1. Discover the IGD gateway on the local network.
        let gateway = igd_tokio::search_gateway(SearchOptions::default())
            .await
            .map_err(|search_error| {
                let message = format!("UPnP gateway discovery failed: {search_error}");
                self.last_error = Some(message.clone());
                self.is_active = false;
                message
            })?;

        // 2. Determine the local address that routes to the gateway.
        let local_ipv4 = detect_local_ipv4(&gateway.addr).map_err(|detection_error| {
            let message = format!("Failed to determine local IP: {detection_error}");
            self.last_error = Some(message.clone());
            self.is_active = false;
            message
        })?;

        let local_socket = SocketAddrV4::new(local_ipv4, self.internal_port);

        // 3. Retrieve the external (public) IP from the gateway.
        let external_ip = gateway
            .get_external_ip()
            .await
            .map_err(|ip_error| {
                let message = format!("Failed to get external IP from gateway: {ip_error}");
                self.last_error = Some(message.clone());
                self.is_active = false;
                message
            })?;

        // 4. Add (or replace) the TCP port mapping.
        gateway
            .add_port(
                PortMappingProtocol::TCP,
                self.external_port,
                local_socket,
                LEASE_DURATION_SECONDS,
                PORT_MAPPING_DESCRIPTION,
            )
            .await
            .map_err(|port_error| {
                let message = format!("Failed to add port mapping: {port_error}");
                self.last_error = Some(message.clone());
                self.is_active = false;
                message
            })?;

        let public_ip_string = external_ip.to_string();
        let public_url = format!("http://{}:{}", public_ip_string, self.external_port);

        self.gateway = Some(gateway);
        self.local_ip = Some(local_ipv4);
        self.public_ip = Some(public_ip_string);
        self.is_active = true;
        self.last_error = None;

        tracing::info!(
            "UPnP port mapping established: {} -> {}:{} (lease {}s)",
            public_url,
            local_socket.ip(),
            local_socket.port(),
            LEASE_DURATION_SECONDS,
        );

        Ok(public_url)
    }

    /// Remove the port mapping from the gateway and mark the manager as
    /// disabled.
    pub async fn disable(&mut self) {
        self.is_enabled = false;

        if let Some(ref gateway) = self.gateway {
            match gateway
                .remove_port(PortMappingProtocol::TCP, self.external_port)
                .await
            {
                Ok(()) => {
                    tracing::info!(
                        "UPnP port mapping removed for external port {}",
                        self.external_port
                    );
                }
                Err(remove_error) => {
                    tracing::warn!(
                        "Failed to remove UPnP port mapping: {remove_error}"
                    );
                }
            }
        }

        self.is_active = false;
        self.public_ip = None;
        self.local_ip = None;
        self.gateway = None;
        self.last_error = None;
    }

    /// Renew the existing port mapping lease. Call this periodically (every
    /// ~30 minutes) so the mapping does not expire.
    ///
    /// If the gateway reference is lost or the renewal fails, attempts a full
    /// re-discovery and re-mapping.
    pub async fn refresh(&mut self) {
        if !self.is_enabled {
            return;
        }

        // If we lost the gateway handle, try to re-establish everything.
        if self.gateway.is_none() {
            tracing::info!("UPnP refresh: no gateway handle, attempting full re-enable");
            match self.enable().await {
                Ok(public_url) => {
                    tracing::info!(
                        "UPnP re-established after lost gateway: {public_url}"
                    );
                }
                Err(enable_error) => {
                    tracing::error!("UPnP re-enable failed: {enable_error}");
                }
            }
            return;
        }

        let gateway = self.gateway.as_ref().unwrap();

        // Re-determine local address in case the interface changed.
        let local_ipv4 = match detect_local_ipv4(&gateway.addr) {
            Ok(address) => address,
            Err(detection_error) => {
                let message = format!("UPnP refresh: {detection_error}");
                tracing::warn!("{message}");
                self.last_error = Some(message);
                self.is_active = false;
                // Drop the stale gateway so the next refresh does a full re-enable.
                self.gateway = None;
                return;
            }
        };

        let local_socket = SocketAddrV4::new(local_ipv4, self.internal_port);

        match gateway
            .add_port(
                PortMappingProtocol::TCP,
                self.external_port,
                local_socket,
                LEASE_DURATION_SECONDS,
                PORT_MAPPING_DESCRIPTION,
            )
            .await
        {
            Ok(()) => {
                self.local_ip = Some(local_ipv4);
                self.is_active = true;
                self.last_error = None;
                tracing::debug!(
                    "UPnP port mapping renewed for external port {}",
                    self.external_port
                );
            }
            Err(renew_error) => {
                let message =
                    format!("UPnP renewal failed: {renew_error}");
                tracing::warn!("{message}");
                self.last_error = Some(message);
                self.is_active = false;
                // Drop the stale gateway so the next refresh does a full re-enable.
                self.gateway = None;
            }
        }
    }

    /// Return a snapshot of the current UPnP state.
    pub fn get_status(&self) -> UpnpStatus {
        UpnpStatus {
            is_enabled: self.is_enabled,
            is_active: self.is_active,
            public_url: if self.is_active {
                self.public_ip
                    .as_ref()
                    .map(|ip| format!("http://{}:{}", ip, self.external_port))
            } else {
                None
            },
            public_ip: self.public_ip.clone(),
            external_port: self.external_port,
            internal_port: self.internal_port,
            last_error: self.last_error.clone(),
        }
    }

    /// Quick check whether the port mapping is still registered on the gateway.
    /// Does NOT verify end-to-end reachability from the internet.
    pub async fn test_reachability(&self) -> bool {
        let Some(ref gateway) = self.gateway else {
            return false;
        };

        // Ask the gateway for the specific port mapping. If it exists, the
        // mapping is at least registered on the router.
        match gateway
            .get_specific_port_mapping_entry(
                PortMappingProtocol::TCP,
                self.external_port,
            )
            .await
        {
            Ok(_entry) => true,
            Err(_) => false,
        }
    }

    /// Update the external port. The caller should subsequently call
    /// [`disable`] then [`enable`] to re-establish the mapping.
    pub fn set_external_port(&mut self, new_external_port: u16) {
        self.external_port = new_external_port;
    }
}
