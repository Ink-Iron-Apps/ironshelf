import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../providers/auth_provider.dart';
import '../providers/cloud_provider.dart';
import '../providers/server_provider.dart';
import '../providers/settings_provider.dart';
import '../services/update_service.dart';
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
          // Surfaces a sideload update when one is published (Android only).
          const _UpdateCard(),

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
            leading: const Icon(Icons.format_quote_rounded),
            title: const Text('Highlights & Bookmarks'),
            trailing: const Icon(Icons.chevron_right, size: 20),
            onTap: () => context.push('/annotations'),
          ),
          ListTile(
            leading: const Icon(Icons.notifications_none_rounded),
            title: const Text('Notifications'),
            trailing: const Icon(Icons.chevron_right, size: 20),
            onTap: () => context.push('/notifications'),
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
            onTap: () => context.push('/stats'),
          ),
          ListTile(
            leading: const Icon(Icons.swap_horiz_rounded),
            title: const Text('Switch server'),
            subtitle: const Text('Connect to another of your servers'),
            trailing: const Icon(Icons.chevron_right, size: 20),
            onTap: () => context.go('/cloud-servers'),
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
          ListTile(
            leading: const Icon(Icons.security_outlined),
            title: const Text('Report Security Issue'),
            onTap: () => _reportSecurity(context),
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
            subtitle: const Text('Sign out of your cloud account'),
            onTap: () async {
              final shouldLogout = await showDialog<bool>(
                context: context,
                builder: (dialogContext) => AlertDialog(
                  title: const Text('Sign out?'),
                  content: const Text(
                      'You will be signed out of your Ironshelf cloud account '
                      'and disconnected from this server.'),
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
                await ref.read(serverConfigProvider.notifier).disconnect();
                await ref.read(cloudAuthProvider.notifier).logout();
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

  /// App version + OS line appended to support emails so we don't have to ask.
  Future<String> _diagnosticFooter() async {
    final info = await PackageInfo.fromPlatform();
    final os = '${Platform.operatingSystem} ${Platform.operatingSystemVersion}';
    return '\n\n---\nIronshelf v${info.version} (${info.buildNumber})\n$os';
  }

  Future<void> _sendFeedback(BuildContext context) async {
    final footer = await _diagnosticFooter();
    final uri = Uri(
      scheme: 'mailto',
      path: 'support@inknironapps.com',
      queryParameters: {
        'subject': 'Ironshelf feedback',
        'body': 'Your feedback:$footer',
      },
    );
    await launchUrl(uri);
  }

  Future<void> _reportBug(BuildContext context) async {
    final footer = await _diagnosticFooter();
    final uri = Uri(
      scheme: 'mailto',
      path: 'support@inknironapps.com',
      queryParameters: {
        'subject': 'Ironshelf bug report',
        'body': 'What happened:\n\nSteps to reproduce:\n$footer',
      },
    );
    await launchUrl(uri);
  }

  Future<void> _reportSecurity(BuildContext context) async {
    final footer = await _diagnosticFooter();
    final uri = Uri(
      scheme: 'mailto',
      path: 'security@inknironapps.com',
      queryParameters: {
        'subject': 'Ironshelf security report',
        'body': 'Describe the vulnerability:$footer',
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

/// Update card (Android sideload). Checks GitHub Releases on mount; shows a
/// prominent card only when a newer app version is available, with in-app
/// download + install. Hidden entirely when up to date or on other platforms.
class _UpdateCard extends StatefulWidget {
  const _UpdateCard();

  @override
  State<_UpdateCard> createState() => _UpdateCardState();
}

class _UpdateCardState extends State<_UpdateCard> {
  AppUpdateInfo? _update;
  bool _downloading = false;
  double _progress = 0;

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    try {
      final update = await UpdateService.checkForUpdate();
      if (mounted) setState(() => _update = update);
    } catch (_) {
      // Offline / rate-limited — just don't show the card.
    }
  }

  Future<void> _install() async {
    final update = _update;
    if (update == null) return;
    setState(() => _downloading = true);
    try {
      await UpdateService.downloadAndInstall(
        update,
        onProgress: (p) {
          if (mounted) setState(() => _progress = p);
        },
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Update failed: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final update = _update;
    if (update == null) return const SizedBox.shrink();
    final theme = Theme.of(context);

    return Card(
      margin: const EdgeInsets.fromLTRB(12, 12, 12, 4),
      color: theme.colorScheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(Icons.system_update, color: theme.colorScheme.onPrimaryContainer),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Update available',
                      style: theme.textTheme.titleSmall?.copyWith(
                        color: theme.colorScheme.onPrimaryContainer,
                        fontWeight: FontWeight.w600,
                      )),
                  Text('Version ${update.version}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onPrimaryContainer,
                      )),
                  if (_downloading) ...[
                    const SizedBox(height: 8),
                    LinearProgressIndicator(value: _progress),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            if (!_downloading)
              FilledButton(
                onPressed: _install,
                child: const Text('Update'),
              )
            else
              Text('${(_progress * 100).round()}%',
                  style: TextStyle(color: theme.colorScheme.onPrimaryContainer)),
          ],
        ),
      ),
    );
  }
}
