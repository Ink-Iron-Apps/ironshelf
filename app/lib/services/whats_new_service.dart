import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../theme.dart';

/// Shows a "What's New" dialog on the first launch after an app update.
///
/// Compares the running version against the last version the user has seen
/// (stored locally). On a fresh install nothing is shown — we just record the
/// current version so the dialog only appears after a real update.
class WhatsNewService {
  static const _lastSeenVersionKey = 'whats_new_last_seen_version';

  static Future<void> maybeShow(BuildContext context) async {
    final prefs = await SharedPreferences.getInstance();
    final info = await PackageInfo.fromPlatform();
    final currentVersion = info.version;
    final lastSeen = prefs.getString(_lastSeenVersionKey);

    // Fresh install: record and stay quiet.
    if (lastSeen == null) {
      await prefs.setString(_lastSeenVersionKey, currentVersion);
      return;
    }
    if (lastSeen == currentVersion) return;

    final entries = await _loadSectionFor(currentVersion);
    // Always advance the marker so we don't nag, even if the changelog has no
    // matching section.
    await prefs.setString(_lastSeenVersionKey, currentVersion);
    if (entries.isEmpty || !context.mounted) return;

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text("What's New in v$currentVersion"),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: entries
                .map((line) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Padding(
                            padding: EdgeInsets.only(top: 2, right: 8),
                            child: Icon(Icons.circle,
                                size: 6, color: IronshelfColors.tealBright),
                          ),
                          Expanded(child: Text(line)),
                        ],
                      ),
                    ))
                .toList(),
          ),
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Got it'),
          ),
        ],
      ),
    );
  }

  /// Parse the bundled CHANGELOG for the section matching [version] and return
  /// its bullet lines (category headers like "### Added" are skipped).
  static Future<List<String>> _loadSectionFor(String version) async {
    final String content;
    try {
      content = await rootBundle.loadString('CHANGELOG.md');
    } catch (_) {
      return const [];
    }

    final lines = content.split('\n');
    final bullets = <String>[];
    var inSection = false;

    for (final raw in lines) {
      final line = raw.trimRight();
      if (line.startsWith('## ')) {
        final heading = line.substring(3).trim();
        // Match "0.1.0" or "[0.1.0]" style headings that contain the version.
        if (inSection) break; // reached the next version section
        inSection = heading.contains(version);
        continue;
      }
      if (!inSection) continue;
      if (line.startsWith('- ')) {
        bullets.add(line.substring(2).trim());
      }
    }
    return bullets;
  }
}
