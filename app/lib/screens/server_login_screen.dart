import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/auth_provider.dart';
import '../providers/server_provider.dart';
import '../services/api_service.dart';
import '../theme.dart';

/// Direct server connection — the app's entry point. The user enters their
/// server URL plus username + password; the app saves the URL, then POSTs to
/// {serverUrl}/api/v1/auth/login and stores the returned session as its token.
class ServerLoginScreen extends ConsumerStatefulWidget {
  const ServerLoginScreen({super.key});

  @override
  ConsumerState<ServerLoginScreen> createState() => _ServerLoginScreenState();
}

enum _Mode { login, register }

class _ServerLoginScreenState extends ConsumerState<ServerLoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _serverUrl = TextEditingController();
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _inviteCode = TextEditingController();

  _Mode _mode = _Mode.login;
  bool _obscure = true;
  bool _submitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _serverUrl.dispose();
    _username.dispose();
    _password.dispose();
    _inviteCode.dispose();
    super.dispose();
  }

  /// Trim a trailing slash so we don't end up with `https://host//api/v1`.
  String _normalizeUrl(String raw) {
    var url = raw.trim();
    while (url.endsWith('/')) {
      url = url.substring(0, url.length - 1);
    }
    return url;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _errorMessage = null;
    });

    final serverUrl = _normalizeUrl(_serverUrl.text);
    final serverConfigNotifier = ref.read(serverConfigProvider.notifier);

    try {
      // Persist + configure the API client against this server first, so the
      // auth provider's login call targets the right base URL.
      await serverConfigNotifier.saveServer(serverUrl);

      final authNotifier = ref.read(authProvider.notifier);
      if (_mode == _Mode.login) {
        await authNotifier.login(_username.text.trim(), _password.text);
      } else {
        final invite = _inviteCode.text.trim();
        await authNotifier.register(
          _username.text.trim(),
          _password.text,
          inviteCode: invite.isEmpty ? null : invite,
        );
      }

      final authState = ref.read(authProvider);
      if (authState.isAuthenticated) {
        if (mounted) context.go('/');
        return;
      }

      // Login failed — clear the half-saved server so the next attempt starts
      // clean, and surface the server's error message.
      await serverConfigNotifier.disconnect();
      if (mounted) {
        setState(() => _errorMessage =
            authState.errorMessage ?? 'Sign in failed. Check your credentials.');
      }
    } on ApiException catch (apiError) {
      await serverConfigNotifier.disconnect();
      if (mounted) setState(() => _errorMessage = apiError.message);
    } catch (error) {
      await serverConfigNotifier.disconnect();
      if (mounted) {
        setState(() => _errorMessage = 'Could not connect to "$serverUrl".');
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isRegister = _mode == _Mode.register;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(Icons.shelves,
                        size: 56, color: IronshelfColors.tealBright),
                    const SizedBox(height: 16),
                    Text('Ironshelf',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.headlineMedium
                            ?.copyWith(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Text(
                      isRegister
                          ? 'Create an account on your server'
                          : 'Connect to your Ironshelf server',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 28),
                    TextFormField(
                      controller: _serverUrl,
                      keyboardType: TextInputType.url,
                      autocorrect: false,
                      decoration: const InputDecoration(
                        labelText: 'Server URL',
                        hintText: 'https://library.example.com',
                        prefixIcon: Icon(Icons.dns_outlined),
                      ),
                      validator: (value) {
                        final text = value?.trim() ?? '';
                        if (text.isEmpty) return 'Enter your server URL';
                        final uri = Uri.tryParse(_normalizeUrl(text));
                        if (uri == null ||
                            !uri.hasScheme ||
                            (uri.scheme != 'http' && uri.scheme != 'https') ||
                            uri.host.isEmpty) {
                          return 'Enter a valid http(s) URL';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _username,
                      autofillHints: const [AutofillHints.username],
                      decoration: const InputDecoration(
                        labelText: 'Username',
                        prefixIcon: Icon(Icons.person_outline),
                      ),
                      validator: (value) => (value == null || value.trim().isEmpty)
                          ? 'Enter your username'
                          : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _password,
                      obscureText: _obscure,
                      autofillHints: const [AutofillHints.password],
                      decoration: InputDecoration(
                        labelText: 'Password',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          icon: Icon(_obscure
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined),
                          onPressed: () =>
                              setState(() => _obscure = !_obscure),
                        ),
                      ),
                      validator: (value) => (value == null || value.length < 6)
                          ? 'Password must be at least 6 characters'
                          : null,
                    ),
                    if (isRegister) ...[
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _inviteCode,
                        decoration: const InputDecoration(
                          labelText: 'Invite code (if required)',
                          prefixIcon: Icon(Icons.vpn_key_outlined),
                        ),
                      ),
                    ],
                    if (_errorMessage != null) ...[
                      const SizedBox(height: 12),
                      Text(_errorMessage!,
                          style: TextStyle(color: theme.colorScheme.error)),
                    ],
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: _submitting ? null : _submit,
                      child: _submitting
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(isRegister ? 'Create account' : 'Connect'),
                    ),
                    TextButton(
                      onPressed: _submitting
                          ? null
                          : () => setState(() {
                                _errorMessage = null;
                                _mode =
                                    isRegister ? _Mode.login : _Mode.register;
                              }),
                      child: Text(isRegister
                          ? 'Already have an account? Sign in'
                          : "Don't have an account? Create one"),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
