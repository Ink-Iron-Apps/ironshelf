import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/server_provider.dart';
import '../services/api_service.dart';
import '../theme.dart';

class ServerConnectScreen extends ConsumerStatefulWidget {
  const ServerConnectScreen({super.key});

  @override
  ConsumerState<ServerConnectScreen> createState() =>
      _ServerConnectScreenState();
}

class _ServerConnectScreenState extends ConsumerState<ServerConnectScreen> {
  final _urlController = TextEditingController();
  final _cfClientIdController = TextEditingController();
  final _cfClientSecretController = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  bool _isTesting = false;
  bool _showAdvanced = false;
  String? _errorMessage;
  ServerInfo? _serverInfo;

  @override
  void dispose() {
    _urlController.dispose();
    _cfClientIdController.dispose();
    _cfClientSecretController.dispose();
    super.dispose();
  }

  Future<void> _testConnection() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isTesting = true;
      _errorMessage = null;
      _serverInfo = null;
    });

    try {
      final apiService = ref.read(apiServiceProvider);
      final customHeaders = <String, String>{};
      if (_cfClientIdController.text.isNotEmpty) {
        customHeaders['CF-Access-Client-Id'] = _cfClientIdController.text;
      }
      if (_cfClientSecretController.text.isNotEmpty) {
        customHeaders['CF-Access-Client-Secret'] =
            _cfClientSecretController.text;
      }

      final serverUrl = _normalizeUrl(_urlController.text.trim());
      final info = await apiService.testConnection(
        serverUrl,
        customHeaders: customHeaders.isNotEmpty ? customHeaders : null,
      );

      setState(() {
        _serverInfo = info;
      });
    } on ApiException catch (apiError) {
      setState(() {
        _errorMessage = apiError.message;
      });
    } catch (error) {
      setState(() {
        _errorMessage = 'Could not connect to server. Verify the URL is correct.';
      });
    } finally {
      setState(() {
        _isTesting = false;
      });
    }
  }

  Future<void> _saveAndContinue() async {
    final serverUrl = _normalizeUrl(_urlController.text.trim());
    final customHeaders = <String, String>{};
    if (_cfClientIdController.text.isNotEmpty) {
      customHeaders['CF-Access-Client-Id'] = _cfClientIdController.text;
    }
    if (_cfClientSecretController.text.isNotEmpty) {
      customHeaders['CF-Access-Client-Secret'] =
          _cfClientSecretController.text;
    }

    await ref.read(serverConfigProvider.notifier).saveServer(
          serverUrl,
          customHeaders: customHeaders,
        );

    if (mounted) {
      context.go('/login');
    }
  }

  String _normalizeUrl(String url) {
    var normalized = url;
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://$normalized';
    }
    if (normalized.endsWith('/')) {
      normalized = normalized.substring(0, normalized.length - 1);
    }
    return normalized;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

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
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Logo / brand
                    Icon(
                      Icons.shelves,
                      size: 56,
                      color: IronshelfColors.tealBright,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Ironshelf',
                      style: theme.textTheme.headlineMedium?.copyWith(
                        color: IronshelfColors.paper,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Connect to your library',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 36),

                    // Server URL
                    TextFormField(
                      controller: _urlController,
                      keyboardType: TextInputType.url,
                      textInputAction: TextInputAction.next,
                      autocorrect: false,
                      decoration: const InputDecoration(
                        labelText: 'Server URL',
                        hintText: 'https://your-server.example.com',
                        prefixIcon: Icon(Icons.dns_outlined, size: 20),
                      ),
                      validator: (value) {
                        if (value == null || value.trim().isEmpty) {
                          return 'Server URL is required';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 12),

                    // Advanced: Cloudflare Access
                    InkWell(
                      onTap: () {
                        setState(() => _showAdvanced = !_showAdvanced);
                      },
                      borderRadius: BorderRadius.circular(8),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                            vertical: 8, horizontal: 4),
                        child: Row(
                          children: [
                            Icon(
                              _showAdvanced
                                  ? Icons.expand_less
                                  : Icons.expand_more,
                              size: 20,
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                            const SizedBox(width: 8),
                            Text(
                              'Custom headers (Cloudflare Access)',
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),

                    if (_showAdvanced) ...[
                      const SizedBox(height: 8),
                      TextFormField(
                        controller: _cfClientIdController,
                        autocorrect: false,
                        decoration: const InputDecoration(
                          labelText: 'CF-Access-Client-Id',
                          hintText: 'Optional',
                          isDense: true,
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _cfClientSecretController,
                        autocorrect: false,
                        obscureText: true,
                        decoration: const InputDecoration(
                          labelText: 'CF-Access-Client-Secret',
                          hintText: 'Optional',
                          isDense: true,
                        ),
                      ),
                    ],

                    const SizedBox(height: 20),

                    // Error message
                    if (_errorMessage != null)
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.error.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color:
                                theme.colorScheme.error.withValues(alpha: 0.3),
                          ),
                        ),
                        child: Row(
                          children: [
                            Icon(Icons.error_outline,
                                size: 18, color: theme.colorScheme.error),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _errorMessage!,
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme.colorScheme.error,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),

                    // Server info (success)
                    if (_serverInfo != null) ...[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: IronshelfColors.success.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color:
                                IronshelfColors.success.withValues(alpha: 0.3),
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                const Icon(Icons.check_circle_outline,
                                    size: 18, color: IronshelfColors.success),
                                const SizedBox(width: 8),
                                Text(
                                  'Connected',
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                    color: IronshelfColors.success,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '${_serverInfo!.name} v${_serverInfo!.version}',
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                            if (_serverInfo!.registrationOpen)
                              Text(
                                'Registration is open (first user becomes owner)',
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: IronshelfColors.tealBright,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],

                    const SizedBox(height: 20),

                    // Buttons
                    if (_serverInfo == null)
                      ElevatedButton(
                        onPressed: _isTesting ? null : _testConnection,
                        child: _isTesting
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2),
                              )
                            : const Text('Test connection'),
                      )
                    else
                      ElevatedButton(
                        onPressed: _saveAndContinue,
                        child: const Text('Continue'),
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
