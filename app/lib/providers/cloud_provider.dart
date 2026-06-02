import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/cloud_service.dart';

/// Singleton cloud client.
final cloudServiceProvider = Provider<CloudService>((ref) => CloudService());

/// Whether the user is signed in to the cloud (has a stored cloud token).
final cloudConfiguredProvider = Provider<bool>((ref) {
  return ref.watch(cloudAuthProvider).token != null;
});

class CloudAuthState {
  final String? token;
  final String? username;
  final bool isLoading;
  final String? errorMessage;

  const CloudAuthState({
    this.token,
    this.username,
    this.isLoading = false,
    this.errorMessage,
  });

  CloudAuthState copyWith({
    String? token,
    String? username,
    bool? isLoading,
    String? errorMessage,
  }) {
    return CloudAuthState(
      token: token ?? this.token,
      username: username ?? this.username,
      isLoading: isLoading ?? this.isLoading,
      errorMessage: errorMessage,
    );
  }
}

final cloudAuthProvider =
    StateNotifierProvider<CloudAuthNotifier, CloudAuthState>((ref) {
  return CloudAuthNotifier(ref);
});

class CloudAuthNotifier extends StateNotifier<CloudAuthState> {
  final Ref _ref;
  static const _tokenKey = 'cloud_token';
  static const _usernameKey = 'cloud_username';

  CloudAuthNotifier(this._ref) : super(const CloudAuthState()) {
    _load();
  }

  CloudService get _cloud => _ref.read(cloudServiceProvider);

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString(_tokenKey);
    if (token == null) return;
    _cloud.token = token;
    state = CloudAuthState(
      token: token,
      username: prefs.getString(_usernameKey),
    );
  }

  Future<void> _persist(String token, String username) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, token);
    await prefs.setString(_usernameKey, username);
    _cloud.token = token;
    state = CloudAuthState(token: token, username: username);
  }

  Future<bool> login(String emailOrUsername, String password) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final result = await _cloud.login(emailOrUsername, password);
      await _persist(result.token, result.username);
      return true;
    } on CloudException catch (e) {
      state = CloudAuthState(errorMessage: e.message);
      return false;
    }
  }

  Future<bool> register({
    required String email,
    required String username,
    required String password,
  }) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final result = await _cloud.register(
          email: email, username: username, password: password);
      await _persist(result.token, result.username);
      return true;
    } on CloudException catch (e) {
      state = CloudAuthState(errorMessage: e.message);
      return false;
    }
  }

  Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    await prefs.remove(_usernameKey);
    _cloud.token = null;
    state = const CloudAuthState();
  }

  void clearError() => state = state.copyWith(errorMessage: null);
}
