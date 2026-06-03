import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/auth_provider.dart';
import '../providers/cloud_provider.dart';
import '../providers/server_provider.dart';
import '../services/cloud_service.dart';
import '../theme.dart';

/// Pick which of the account's servers to connect to. Connecting issues a
/// short-lived cloud token, exchanges it at the server for a session, and then
/// the app talks to that server directly.
class CloudServersScreen extends ConsumerStatefulWidget {
  const CloudServersScreen({super.key});

  @override
  ConsumerState<CloudServersScreen> createState() =>
      _CloudServersScreenState();
}

class _CloudServersScreenState extends ConsumerState<CloudServersScreen> {
  late Future<List<CloudServer>> _serversFuture;
  String? _connectingId;

  @override
  void initState() {
    super.initState();
    _serversFuture = ref.read(cloudServiceProvider).listServers();
  }

  void _reload() {
    setState(() {
      _serversFuture = ref.read(cloudServiceProvider).listServers();
    });
  }

  Future<void> _connect(CloudServer server) async {
    setState(() => _connectingId = server.id);
    try {
      final cloud = ref.read(cloudServiceProvider);
      final connection = await cloud.connectToServer(server.id);

      // Exchange the cloud token for a local server session, then store creds.
      final api = ref.read(apiServiceProvider);
      final sessionId = await api.cloudLoginToServer(
        connection.serverUrl,
        connection.serverAccessToken,
      );

      final serverConfigNotifier = ref.read(serverConfigProvider.notifier);
      await serverConfigNotifier.saveServer(connection.serverUrl);
      await serverConfigNotifier.saveAuth(sessionId: sessionId);
      await ref.read(authProvider.notifier).reload();

      if (mounted && ref.read(authProvider).isAuthenticated) {
        context.go('/');
      } else if (mounted) {
        _showError('Connected, but the server rejected the session.');
      }
    } on CloudException catch (e) {
      _showError(e.message);
    } catch (e) {
      _showError('Could not reach "${server.name}". Is it online?');
    } finally {
      if (mounted) setState(() => _connectingId = null);
    }
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _signOutCloud() async {
    await ref.read(cloudAuthProvider.notifier).logout();
    if (mounted) context.go('/cloud-login');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final username = ref.watch(cloudAuthProvider).username;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Your Servers'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sign out of cloud',
            onPressed: _signOutCloud,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => _reload(),
        child: FutureBuilder<List<CloudServer>>(
          future: _serversFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return _MessageView(
                icon: Icons.cloud_off,
                title: 'Could not load your servers',
                subtitle: '${snapshot.error}',
                actionLabel: 'Retry',
                onAction: _reload,
              );
            }
            final servers = snapshot.data ?? const [];
            if (servers.isEmpty) {
              return _MessageView(
                icon: Icons.dns_outlined,
                title: 'No servers yet',
                subtitle: username == null
                    ? 'Claim a server from its setup screen, then pull to refresh.'
                    : 'Hi $username — claim a server from its setup screen, then '
                        'pull down to refresh.',
                actionLabel: 'Refresh',
                onAction: _reload,
              );
            }
            return ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: servers.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final server = servers[index];
                final connecting = _connectingId == server.id;
                return ListTile(
                  leading: Icon(
                    server.isOwned ? Icons.dns_rounded : Icons.share_rounded,
                    color: theme.colorScheme.primary,
                  ),
                  title: Text(server.name),
                  subtitle: Text(
                    [
                      if (server.version != null) 'v${server.version}',
                      if (!server.isOwned) server.permissions ?? 'shared',
                    ].join(' · '),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  trailing: connecting
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.chevron_right),
                  onTap:
                      _connectingId == null ? () => _connect(server) : null,
                );
              },
            );
          },
        ),
      ),
    );
  }
}

class _MessageView extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final String actionLabel;
  final VoidCallback onAction;

  const _MessageView({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.actionLabel,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      children: [
        const SizedBox(height: 80),
        Icon(icon, size: 56, color: IronshelfColors.tealBright),
        const SizedBox(height: 16),
        Text(title,
            textAlign: TextAlign.center,
            style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Text(subtitle,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              )),
        ),
        const SizedBox(height: 20),
        Center(
          child: FilledButton(onPressed: onAction, child: Text(actionLabel)),
        ),
      ],
    );
  }
}
