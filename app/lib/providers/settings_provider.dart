import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Theme mode provider (dark/light/system).
final themeModeProvider =
    StateNotifierProvider<ThemeModeNotifier, ThemeMode>(
        (ref) => ThemeModeNotifier());

class ThemeModeNotifier extends StateNotifier<ThemeMode> {
  ThemeModeNotifier() : super(ThemeMode.dark) {
    _loadFromPrefs();
  }

  Future<void> _loadFromPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    final themeIndex = prefs.getInt('theme_mode') ?? 0;
    state = ThemeMode.values[themeIndex.clamp(0, ThemeMode.values.length - 1)];
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = mode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt('theme_mode', mode.index);
  }
}

/// Genre browse provider.
final genresProvider =
    AsyncNotifierProvider<GenresNotifier, List<GenreData>>(
        GenresNotifier.new);

class GenreData {
  final String name;
  final int bookCount;

  const GenreData({required this.name, required this.bookCount});
}

class GenresNotifier extends AsyncNotifier<List<GenreData>> {
  @override
  Future<List<GenreData>> build() async {
    return [];
  }
}
