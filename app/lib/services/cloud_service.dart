import 'package:dio/dio.dart';

/// A server the cloud account owns or has been granted access to.
class CloudServer {
  final String id;
  final String name;
  final String url;
  final bool isVerified;
  final String? lastSeenAt;
  final String? version;
  final String? permissions; // null = owned; else "viewer"/"editor"/...

  const CloudServer({
    required this.id,
    required this.name,
    required this.url,
    required this.isVerified,
    this.lastSeenAt,
    this.version,
    this.permissions,
  });

  factory CloudServer.fromJson(Map<String, dynamic> json) {
    return CloudServer(
      id: json['id'].toString(),
      name: json['name'] as String? ?? 'Server',
      url: json['url'] as String? ?? '',
      isVerified: json['is_verified'] == true,
      lastSeenAt: json['last_seen_at'] as String?,
      version: json['version'] as String?,
      permissions: json['permissions'] as String?,
    );
  }

  bool get isOwned => permissions == null;
}

/// Token + URL issued by the cloud for connecting to a specific server.
class ServerConnection {
  final String serverAccessToken;
  final String serverUrl;
  final String serverName;

  const ServerConnection({
    required this.serverAccessToken,
    required this.serverUrl,
    required this.serverName,
  });
}

class CloudException implements Exception {
  final String message;
  const CloudException(this.message);
  @override
  String toString() => message;
}

/// Client for the Ironshelf cloud service (Cloudflare Worker). The cloud is an
/// auth broker + server directory — it is not a proxy. After listing servers
/// and issuing a per-server access token, the app talks to the server directly.
class CloudService {
  static const String baseUrl =
      'https://ironshelf-cloud.padragantrbs.workers.dev';

  final Dio _dio = Dio(BaseOptions(
    baseUrl: baseUrl,
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 20),
    headers: {'Content-Type': 'application/json'},
  ));

  String? _token;

  /// Set the cloud bearer token for authenticated calls.
  set token(String? value) => _token = value;

  Options get _authed => Options(
        headers: _token != null ? {'Authorization': 'Bearer $_token'} : null,
      );

  /// Unwrap the cloud's `{ ok, data, error }` envelope.
  dynamic _unwrap(Response response) {
    final body = response.data;
    if (body is Map<String, dynamic>) {
      if (body['ok'] == true) return body['data'];
      throw CloudException(body['error'] as String? ?? 'Request failed');
    }
    return body;
  }

  Future<T> _guard<T>(Future<T> Function() run) async {
    try {
      return await run();
    } on DioException catch (e) {
      final data = e.response?.data;
      if (data is Map && data['error'] is String) {
        throw CloudException(data['error'] as String);
      }
      if (e.type == DioExceptionType.connectionError ||
          e.type == DioExceptionType.connectionTimeout) {
        throw const CloudException('Could not reach the cloud service.');
      }
      throw CloudException(e.message ?? 'Cloud request failed');
    }
  }

  /// Log in. Returns (token, username). [emailOrUsername] accepts either.
  Future<({String token, String username})> login(
    String emailOrUsername,
    String password,
  ) {
    return _guard(() async {
      final response = await _dio.post('/auth/login', data: {
        'email_or_username': emailOrUsername,
        'password': password,
      });
      final data = _unwrap(response) as Map<String, dynamic>;
      return (
        token: data['token'] as String,
        username: data['username'] as String? ?? emailOrUsername,
      );
    });
  }

  /// Register a new cloud account. Returns (token, username).
  Future<({String token, String username})> register({
    required String email,
    required String username,
    required String password,
  }) {
    return _guard(() async {
      final response = await _dio.post('/auth/register', data: {
        'email': email,
        'username': username,
        'password': password,
      });
      final data = _unwrap(response) as Map<String, dynamic>;
      return (
        token: data['token'] as String,
        username: data['username'] as String? ?? username,
      );
    });
  }

  /// Request a password-reset email. Always succeeds (no account enumeration).
  Future<void> forgotPassword(String email) {
    return _guard(() async {
      await _dio.post('/auth/forgot-password', data: {'email': email});
    });
  }

  /// List all servers available to the account (owned + shared).
  Future<List<CloudServer>> listServers() {
    return _guard(() async {
      final responses = await Future.wait([
        _dio.get('/servers/mine', options: _authed),
        _dio.get('/servers/shared', options: _authed),
      ]);
      final servers = <CloudServer>[];
      for (final response in responses) {
        final data = _unwrap(response);
        if (data is List) {
          servers.addAll(data
              .cast<Map<String, dynamic>>()
              .map(CloudServer.fromJson));
        }
      }
      return servers;
    });
  }

  /// Issue a short-lived access token for a specific server.
  Future<ServerConnection> connectToServer(String serverId) {
    return _guard(() async {
      final response =
          await _dio.post('/servers/$serverId/token', options: _authed);
      final data = _unwrap(response) as Map<String, dynamic>;
      return ServerConnection(
        serverAccessToken: data['server_access_token'] as String,
        serverUrl: data['server_url'] as String,
        serverName: data['server_name'] as String? ?? 'Server',
      );
    });
  }
}
