import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/cloud_provider.dart';
import '../services/cloud_service.dart';
import '../theme.dart';

/// Cloud account sign-in — the app's only entry point. Connecting through the
/// cloud is what makes a self-hosted library reachable from anywhere.
class CloudLoginScreen extends ConsumerStatefulWidget {
  const CloudLoginScreen({super.key});

  @override
  ConsumerState<CloudLoginScreen> createState() => _CloudLoginScreenState();
}

enum _Mode { login, register }

class _CloudLoginScreenState extends ConsumerState<CloudLoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _identifier = TextEditingController(); // email or username (login)
  final _email = TextEditingController();
  final _username = TextEditingController();
  final _password = TextEditingController();

  _Mode _mode = _Mode.login;
  bool _obscure = true;

  @override
  void dispose() {
    _identifier.dispose();
    _email.dispose();
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final notifier = ref.read(cloudAuthProvider.notifier);

    final ok = _mode == _Mode.login
        ? await notifier.login(_identifier.text.trim(), _password.text)
        : await notifier.register(
            email: _email.text.trim(),
            username: _username.text.trim(),
            password: _password.text,
          );

    if (ok && mounted) context.go('/cloud-servers');
  }

  Future<void> _forgotPassword() async {
    final emailController = TextEditingController(text: _identifier.text.trim());
    final email = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Reset password'),
        content: TextField(
          controller: emailController,
          keyboardType: TextInputType.emailAddress,
          decoration: const InputDecoration(
            labelText: 'Account email',
            hintText: 'you@example.com',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(dialogContext, emailController.text.trim()),
            child: const Text('Send reset link'),
          ),
        ],
      ),
    );
    if (email == null || email.isEmpty || !mounted) return;
    try {
      await ref.read(cloudServiceProvider).forgotPassword(email);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
                'If that account exists, a reset link is on its way. Check your '
                'inbox (and spam folder).'),
          ),
        );
      }
    } on CloudException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cloudAuth = ref.watch(cloudAuthProvider);
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
                          ? 'Create your cloud account'
                          : 'Sign in to reach your library anywhere',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 28),

                    if (isRegister) ...[
                      TextFormField(
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email],
                        decoration: const InputDecoration(
                          labelText: 'Email',
                          prefixIcon: Icon(Icons.email_outlined),
                        ),
                        validator: (v) => (v == null || !v.contains('@'))
                            ? 'Enter a valid email'
                            : null,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _username,
                        decoration: const InputDecoration(
                          labelText: 'Username',
                          prefixIcon: Icon(Icons.person_outline),
                        ),
                        validator: (v) => (v == null || v.trim().length < 2)
                            ? 'Choose a username'
                            : null,
                      ),
                      const SizedBox(height: 12),
                    ] else ...[
                      TextFormField(
                        controller: _identifier,
                        autofillHints: const [AutofillHints.username],
                        decoration: const InputDecoration(
                          labelText: 'Email or username',
                          prefixIcon: Icon(Icons.person_outline),
                        ),
                        validator: (v) => (v == null || v.trim().isEmpty)
                            ? 'Enter your email or username'
                            : null,
                      ),
                      const SizedBox(height: 12),
                    ],

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
                      validator: (v) => (v == null || v.length < 6)
                          ? 'Password must be at least 6 characters'
                          : null,
                    ),

                    if (cloudAuth.errorMessage != null) ...[
                      const SizedBox(height: 12),
                      Text(cloudAuth.errorMessage!,
                          style: TextStyle(color: theme.colorScheme.error)),
                    ],

                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: cloudAuth.isLoading ? null : _submit,
                      child: cloudAuth.isLoading
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(isRegister ? 'Create account' : 'Sign in'),
                    ),
                    const SizedBox(height: 8),
                    if (!isRegister)
                      TextButton(
                        onPressed: _forgotPassword,
                        child: const Text('Forgot password?'),
                      ),
                    TextButton(
                      onPressed: () {
                        ref.read(cloudAuthProvider.notifier).clearError();
                        setState(() =>
                            _mode = isRegister ? _Mode.login : _Mode.register);
                      },
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
