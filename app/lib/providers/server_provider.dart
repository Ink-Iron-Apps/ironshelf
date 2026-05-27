import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/server_config.dart';
import '../services/api_service.dart';

/// Singleton API service instance.
final apiServiceProvider = Provider<ApiService>((ref) {
  return ApiService();
});

/// Server connection state.
final serverConfigProvider =
    StateNotifierProvider<ServerConfigNotifier, ServerConfig?>((ref) {
  return ServerConfigNotifier(ref);
});

/// Whether a server is configured and connected.
final isServerConfiguredProvider = Provider<bool>((ref) {
  return ref.watch(serverConfigProvider) != null;
});

class ServerConfigNotifier extends StateNotifier<ServerConfig?> {
  final Ref _ref;

  ServerConfigNotifier(this._ref) : super(null) {
    _loadFromPrefs();
  }

  Future<void> _loadFromPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    final serverUrl = prefs.getString('server_url');
    if (serverUrl == null || serverUrl.isEmpty) return;

    final customHeadersJson = prefs.getString('custom_headers');
    final customHeaders = customHeadersJson != null
        ? Map<String, String>.from(
            json.decode(customHeadersJson) as Map<String, dynamic>)
        : <String, String>{};

    final sessionId = prefs.getString('session_id');
    final apiKey = prefs.getString('api_key');

    final config = ServerConfig(
      serverUrl: serverUrl,
      customHeaders: customHeaders,
      sessionId: sessionId,
      apiKey: apiKey,
    );

    state = config;

    final apiService = _ref.read(apiServiceProvider);
    apiService.configure(config, onUnauthorized: () {
      clearAuth();
    });
  }

  Future<void> saveServer(
    String serverUrl, {
    Map<String, String> customHeaders = const {},
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('server_url', serverUrl);
    if (customHeaders.isNotEmpty) {
      await prefs.setString('custom_headers', json.encode(customHeaders));
    } else {
      await prefs.remove('custom_headers');
    }

    final config = ServerConfig(
      serverUrl: serverUrl,
      customHeaders: customHeaders,
    );

    state = config;

    final apiService = _ref.read(apiServiceProvider);
    apiService.configure(config, onUnauthorized: () {
      clearAuth();
    });
  }

  Future<void> saveAuth({String? sessionId, String? apiKey}) async {
    final prefs = await SharedPreferences.getInstance();
    if (sessionId != null) {
      await prefs.setString('session_id', sessionId);
    }
    if (apiKey != null) {
      await prefs.setString('api_key', apiKey);
    }

    if (state != null) {
      state = state!.copyWith(sessionId: sessionId, apiKey: apiKey);
      final apiService = _ref.read(apiServiceProvider);
      apiService.updateAuth(sessionId: sessionId, apiKey: apiKey);
    }
  }

  Future<void> clearAuth() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('session_id');
    await prefs.remove('api_key');

    if (state != null) {
      state = ServerConfig(
        serverUrl: state!.serverUrl,
        customHeaders: state!.customHeaders,
      );
      final apiService = _ref.read(apiServiceProvider);
      apiService.configure(state!, onUnauthorized: () {
        clearAuth();
      });
    }
  }

  Future<void> disconnect() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('server_url');
    await prefs.remove('custom_headers');
    await prefs.remove('session_id');
    await prefs.remove('api_key');
    state = null;
  }
}
