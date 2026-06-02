import 'dart:io';

import 'package:dio/dio.dart';
import 'package:open_filex/open_filex.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

/// An available app update discovered on GitHub Releases.
class AppUpdateInfo {
  final String version;
  final String downloadUrl;
  final String? notes;

  const AppUpdateInfo({
    required this.version,
    required this.downloadUrl,
    this.notes,
  });
}

/// Checks for sideloaded app updates published to the public Ironshelf repo's
/// GitHub Releases (tags prefixed `app-v`, with an `.apk` asset), downloads the
/// APK, and hands it to the OS package installer.
///
/// The repo is public, so polling needs no authentication and no separate
/// mirror repo. This only applies to Android sideload builds.
class UpdateService {
  static const _releasesApi =
      'https://api.github.com/repos/LightWraith8268/ironshelf/releases';
  static const _tagPrefix = 'app-v';

  static final Dio _dio = Dio(BaseOptions(
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 60),
  ));

  /// Returns update info if a newer app release exists, else null.
  static Future<AppUpdateInfo?> checkForUpdate() async {
    if (!Platform.isAndroid) return null;

    final info = await PackageInfo.fromPlatform();
    final current = _parseVersion(info.version);

    final response = await _dio.get<List<dynamic>>(
      _releasesApi,
      options: Options(headers: {'Accept': 'application/vnd.github+json'}),
    );
    final releases = response.data ?? const [];

    AppUpdateInfo? best;
    List<int>? bestVersion;

    for (final entry in releases) {
      if (entry is! Map) continue;
      final tag = entry['tag_name'] as String?;
      if (tag == null || !tag.startsWith(_tagPrefix)) continue;

      final version = _parseVersion(tag.substring(_tagPrefix.length));
      if (_compare(version, current) <= 0) continue;
      if (bestVersion != null && _compare(version, bestVersion) <= 0) continue;

      final assets = (entry['assets'] as List?) ?? const [];
      final apk = assets.cast<Map?>().firstWhere(
            (asset) =>
                (asset?['name'] as String?)?.toLowerCase().endsWith('.apk') ??
                false,
            orElse: () => null,
          );
      if (apk == null) continue;

      bestVersion = version;
      best = AppUpdateInfo(
        version: tag.substring(_tagPrefix.length),
        downloadUrl: apk['browser_download_url'] as String,
        notes: entry['body'] as String?,
      );
    }

    return best;
  }

  /// Download the update APK (reporting 0..1 progress) and launch the installer.
  static Future<void> downloadAndInstall(
    AppUpdateInfo update, {
    void Function(double progress)? onProgress,
  }) async {
    final cacheDir = await getTemporaryDirectory();
    final apkPath = '${cacheDir.path}/ironshelf-update.apk';

    await _dio.download(
      update.downloadUrl,
      apkPath,
      onReceiveProgress: (received, total) {
        if (total > 0) onProgress?.call(received / total);
      },
    );

    // Hands the APK to Android's package installer (shows the standard
    // "Install?" prompt). Requires REQUEST_INSTALL_PACKAGES in the manifest.
    await OpenFilex.open(apkPath, type: 'application/vnd.android.package-archive');
  }

  /// Parse "1.2.3" (ignoring any +build / -suffix) into comparable parts.
  static List<int> _parseVersion(String raw) {
    final core = raw.split('+').first.split('-').first.trim();
    return core.split('.').map((part) => int.tryParse(part) ?? 0).toList();
  }

  static int _compare(List<int> a, List<int> b) {
    final length = a.length > b.length ? a.length : b.length;
    for (var i = 0; i < length; i++) {
      final ai = i < a.length ? a[i] : 0;
      final bi = i < b.length ? b[i] : 0;
      if (ai != bi) return ai.compareTo(bi);
    }
    return 0;
  }
}
