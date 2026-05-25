/// Server connection configuration.
/// Stores URL + optional custom headers (e.g. CF-Access tokens).
class ServerConfig {
  final String serverUrl;
  final Map<String, String> customHeaders;
  final String? sessionId;
  final String? apiKey;

  const ServerConfig({
    required this.serverUrl,
    this.customHeaders = const {},
    this.sessionId,
    this.apiKey,
  });

  ServerConfig copyWith({
    String? serverUrl,
    Map<String, String>? customHeaders,
    String? sessionId,
    String? apiKey,
  }) {
    return ServerConfig(
      serverUrl: serverUrl ?? this.serverUrl,
      customHeaders: customHeaders ?? this.customHeaders,
      sessionId: sessionId ?? this.sessionId,
      apiKey: apiKey ?? this.apiKey,
    );
  }

  /// Authorization header value.
  String? get authHeader {
    if (apiKey != null) return 'Bearer $apiKey';
    return null;
  }
}
