/// Sentinel value used by [ServerConfig.copyWith] to explicitly clear a
/// nullable field to null (since passing `null` normally means "keep current").
const _sentinel = Object();

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

  /// Copy with optional overrides. Pass explicit `null` wrapped via the named
  /// parameters to clear nullable fields. Use the default (omit the argument)
  /// to keep the current value.
  ServerConfig copyWith({
    String? serverUrl,
    Map<String, String>? customHeaders,
    Object? sessionId = _sentinel,
    Object? apiKey = _sentinel,
  }) {
    return ServerConfig(
      serverUrl: serverUrl ?? this.serverUrl,
      customHeaders: customHeaders ?? this.customHeaders,
      sessionId:
          identical(sessionId, _sentinel) ? this.sessionId : sessionId as String?,
      apiKey: identical(apiKey, _sentinel) ? this.apiKey : apiKey as String?,
    );
  }

  /// Authorization header value.
  String? get authHeader {
    if (apiKey != null) return 'Bearer $apiKey';
    return null;
  }
}
