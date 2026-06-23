import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import 'server_provider.dart';

/// Authentication state.
enum AuthStatus { unknown, unauthenticated, authenticated, awaitingTwoFactor }

class AuthState {
  final AuthStatus status;
  final UserInfo? user;
  final bool isLoading;
  final String? errorMessage;
  final String? twoFactorToken;

  const AuthState({
    this.status = AuthStatus.unknown,
    this.user,
    this.isLoading = false,
    this.errorMessage,
    this.twoFactorToken,
  });

  AuthState copyWith({
    AuthStatus? status,
    UserInfo? user,
    bool? isLoading,
    String? errorMessage,
    String? twoFactorToken,
  }) {
    return AuthState(
      status: status ?? this.status,
      user: user ?? this.user,
      isLoading: isLoading ?? this.isLoading,
      errorMessage: errorMessage,
      twoFactorToken: twoFactorToken ?? this.twoFactorToken,
    );
  }

  bool get isAuthenticated => status == AuthStatus.authenticated;
  bool get awaitingTwoFactor => status == AuthStatus.awaitingTwoFactor;
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref);
});

/// Whether user is authenticated.
final isAuthenticatedProvider = Provider<bool>((ref) {
  return ref.watch(authProvider).isAuthenticated;
});

class AuthNotifier extends StateNotifier<AuthState> {
  final Ref _ref;

  AuthNotifier(this._ref) : super(const AuthState()) {
    _checkAuth();
  }

  ApiService get _api => _ref.read(apiServiceProvider);

  /// Re-evaluate auth from the currently stored server credentials.
  Future<void> reload() => _checkAuth();

  Future<void> _checkAuth() async {
    final serverConfig = _ref.read(serverConfigProvider);
    if (serverConfig == null ||
        (serverConfig.sessionId == null && serverConfig.apiKey == null)) {
      state = const AuthState(status: AuthStatus.unauthenticated);
      return;
    }

    state = state.copyWith(isLoading: true);
    try {
      final userInfo = await _api.getCurrentUser();
      state = AuthState(
        status: AuthStatus.authenticated,
        user: userInfo,
      );
    } on ApiException {
      state = const AuthState(status: AuthStatus.unauthenticated);
      await _ref.read(serverConfigProvider.notifier).clearAuth();
    }
  }

  Future<void> login(String username, String password) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final authResponse = await _api.login(username, password);

      if (authResponse.twoFactorRequired) {
        state = AuthState(
          status: AuthStatus.awaitingTwoFactor,
          twoFactorToken: authResponse.twoFactorToken,
        );
        return;
      }

      await _ref.read(serverConfigProvider.notifier).saveAuth(
            sessionId: authResponse.sessionId,
          );
      state = AuthState(
        status: AuthStatus.authenticated,
        user: UserInfo(
          userId: authResponse.userId,
          username: authResponse.username,
          isOwner: authResponse.isOwner,
        ),
      );
    } on ApiException catch (apiError) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: apiError.message,
      );
    }
  }

  Future<void> loginTwoFactor(String code) async {
    final token = state.twoFactorToken;
    if (token == null) {
      state = const AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: 'Session expired. Please sign in again.',
      );
      return;
    }
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final authResponse = await _api.loginTwoFactor(token, code);
      await _ref.read(serverConfigProvider.notifier).saveAuth(
            sessionId: authResponse.sessionId,
          );
      state = AuthState(
        status: AuthStatus.authenticated,
        user: UserInfo(
          userId: authResponse.userId,
          username: authResponse.username,
          isOwner: authResponse.isOwner,
        ),
      );
    } on ApiException catch (apiError) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: apiError.message,
      );
    }
  }

  Future<void> register(
    String username,
    String password, {
    String? inviteCode,
  }) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final authResponse = await _api.register(
        username,
        password,
        inviteCode: inviteCode,
      );
      await _ref.read(serverConfigProvider.notifier).saveAuth(
            sessionId: authResponse.sessionId,
          );
      state = AuthState(
        status: AuthStatus.authenticated,
        user: UserInfo(
          userId: authResponse.userId,
          username: authResponse.username,
          isOwner: authResponse.isOwner,
        ),
      );
    } on ApiException catch (apiError) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: apiError.message,
      );
    }
  }

  Future<void> logout() async {
    try {
      await _api.logout();
    } catch (_) {
      // Ignore logout errors — clear local state regardless.
    }
    await _ref.read(serverConfigProvider.notifier).clearAuth();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  void clearError() {
    state = state.copyWith(errorMessage: null);
  }

  void resetToUnauthenticated() {
    state = const AuthState(status: AuthStatus.unauthenticated);
  }
}
