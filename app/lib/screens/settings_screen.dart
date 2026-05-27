import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../providers/auth_provider.dart';
import '../providers/server_provider.dart';
import '../providers/settings_provider.dart';
import '../theme.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final authState = ref.watch(authProvider);
    final currentTheme = ref.watch(themeModeProvider);
    final serverConfig = ref.watch(serverConfigProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          // Account section
          _SectionHeader(title: 'Account'),
          if (authState.user != null)
            ListTile(
              leading: CircleAvatar(
                backgroundColor: theme.colorScheme.primaryContainer,
                child: Text(
                  authState.user!.username.isNotEmpty
                      ? authState.user!.username[0].toUpperCase()
                      : '?',
                  style: TextStyle(
                      color: theme.colorScheme.onPrimaryContainer),
                ),
              ),
              title: Text(authState.user!.username),
              subtitle: Text(
                authState.user!.isOwner ? 'Server owner' : 'User',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          ListTile(
            leading: const Icon(Icons.vpn_key_outlined),
            title: const Text('API Keys'),
            subtitle: const Text('Manage API keys for third-party apps'),
            trailing: const Icon(Icons.chevron_right, size: 20),
            onTap: () {
              // Navigate to API keys management
            },
          ),

          const Divider(),

          // Appearance
          _SectionHeader(title: 'Appearance'),
          ListTile(
            leading: const Icon(Icons.palette_outlined),
            title: const Text('Theme'),
            subtitle: Text(_themeLabel(currentTheme)),
            trailing: const Icon(Icons.chevron_right, size: 20),
            onTap: () => _showThemePicker(context, ref, currentTheme),
          ),

          const Divider(),

          // Server
          _SectionHeader(title: 'Server'),
          if (serverConfig != null)
            ListTile(
              leading: const Icon(Icons.dns_outlined),
              title: const Text('Connected to'),
              subtitle: Text(
                serverConfig.serverUrl,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          ListTile(
            leading: const Icon(Icons.bar_chart_rounded),
            title: const Text('Statistics'),
            trailing: const Icon(Icons.chevron_right, size: 20),
            onTap: () => context.go('/stats'),
          ),

          const Divider(),

          // Support
          _SectionHeader(title: 'Support'),
          ListTile(
            leading: const Icon(Icons.feedback_outlined),
            title: const Text('Send Feedback'),
            onTap: () => _sendFeedback(context),
          ),
          ListTile(
            leading: const Icon(Icons.bug_report_outlined),
            title: const Text('Report a Bug'),
            onTap: () => _reportBug(context),
          ),

          const Divider(),

          // Legal
          _SectionHeader(title: 'Legal'),
          ListTile(
            leading: const Icon(Icons.privacy_tip_outlined),
            title: const Text('Privacy Policy'),
            trailing: const Icon(Icons.open_in_new, size: 16),
            onTap: () => _openUrl('https://inknironapps.com/privacy-policy.html'),
          ),
          ListTile(
            leading: const Icon(Icons.description_outlined),
            title: const Text('Terms & Conditions'),
            trailing: const Icon(Icons.open_in_new, size: 16),
            onTap: () => _openUrl('https://inknironapps.com/terms.html'),
          ),

          const Divider(),

          // Actions
          ListTile(
            leading: Icon(Icons.logout, color: theme.colorScheme.error),
            title: Text('Sign out',
                style: TextStyle(color: theme.colorScheme.error)),
            onTap: () async {
              final shouldLogout = await showDialog<bool>(
                context: context,
                builder: (dialogContext) => AlertDialog(
                  title: const Text('Sign out?'),
                  content: const Text(
                      'You will need to sign in again to access your library.'),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(dialogContext, false),
                      child: const Text('Cancel'),
                    ),
                    TextButton(
                      onPressed: () => Navigator.pop(dialogContext, true),
                      child: Text('Sign out',
                          style: TextStyle(
                              color: theme.colorScheme.error)),
                    ),
                  ],
                ),
              );
              if (shouldLogout == true) {
                await ref.read(authProvider.notifier).logout();
              }
            },
          ),
          ListTile(
            leading: Icon(Icons.link_off,
                color: theme.colorScheme.onSurfaceVariant),
            title: const Text('Disconnect server'),
            subtitle: const Text('Remove saved server configuration'),
            onTap: () async {
              final shouldDisconnect = await showDialog<bool>(
                context: context,
                builder: (dialogContext) => AlertDialog(
                  title: const Text('Disconnect?'),
                  content: const Text(
                      'This will remove the saved server URL and all credentials.'),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(dialogContext, false),
                      child: const Text('Cancel'),
                    ),
                    TextButton(
                      onPressed: () => Navigator.pop(dialogContext, true),
                      child: Text('Disconnect',
                          style: TextStyle(
                              color: theme.colorScheme.error)),
                    ),
                  ],
                ),
              );
              if (shouldDisconnect == true) {
                await ref.read(authProvider.notifier).logout();
                await ref.read(serverConfigProvider.notifier).disconnect();
              }
            },
          ),

          const Divider(),

          // Version footer
          _VersionFooter(),

          const SizedBox(height: 32),
        ],
      ),
    );
  }

  void _showThemePicker(
      BuildContext context, WidgetRef ref, ThemeMode currentTheme) {
    showModalBottomSheet(
      context: context,
      builder: (sheetContext) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(20, 20, 20, 8),
                child: Text('Choose theme'),
              ),
              RadioListTile<ThemeMode>(
                title: const Text('Dark'),
                secondary: const Icon(Icons.dark_mode_rounded),
                value: ThemeMode.dark,
                groupValue: currentTheme,
                onChanged: (value) {
                  ref.read(themeModeProvider.notifier).setThemeMode(value!);
                  Navigator.pop(sheetContext);
                },
              ),
              RadioListTile<ThemeMode>(
                title: const Text('Light'),
                secondary: const Icon(Icons.light_mode_rounded),
                value: ThemeMode.light,
                groupValue: currentTheme,
                onChanged: (value) {
                  ref.read(themeModeProvider.notifier).setThemeMode(value!);
                  Navigator.pop(sheetContext);
                },
              ),
              RadioListTile<ThemeMode>(
                title: const Text('System'),
                secondary: const Icon(Icons.brightness_auto_rounded),
                value: ThemeMode.system,
                groupValue: currentTheme,
                onChanged: (value) {
                  ref.read(themeModeProvider.notifier).setThemeMode(value!);
                  Navigator.pop(sheetContext);
                },
              ),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
  }

  Future<void> _sendFeedback(BuildContext context) async {
    final uri = Uri(
      scheme: 'mailto',
      path: 'support@inknironapps.com',
      queryParameters: {
        'subject': 'Ironshelf feedback',
      },
    );
    await launchUrl(uri);
  }

  Future<void> _reportBug(BuildContext context) async {
    final uri = Uri(
      scheme: 'mailto',
      path: 'support@inknironapps.com',
      queryParameters: {
        'subject': 'Ironshelf bug report',
      },
    );
    await launchUrl(uri);
  }

  Future<void> _openUrl(String url) async {
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  String _themeLabel(ThemeMode mode) {
    switch (mode) {
      case ThemeMode.dark:
        return 'Dark';
      case ThemeMode.light:
        return 'Light';
      case ThemeMode.system:
        return 'System default';
    }
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;

  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Text(
        title,
        style: theme.textTheme.titleSmall?.copyWith(
          color: IronshelfColors.tealBright,
        ),
      ),
    );
  }
}

class _VersionFooter extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return FutureBuilder<PackageInfo>(
      future: PackageInfo.fromPlatform(),
      builder: (context, snapshot) {
        final version = snapshot.data?.version ?? '...';
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          child: Column(
            children: [
              Icon(
                Icons.shelves,
                size: 32,
                color: IronshelfColors.tealBright.withValues(alpha: 0.5),
              ),
              const SizedBox(height: 8),
              Text(
                'Ironshelf v$version',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'Crafted stories. Forged software.',
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant
                      .withValues(alpha: 0.6),
                  fontStyle: FontStyle.italic,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
