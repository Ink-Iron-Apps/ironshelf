import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Ink & Iron brand colors.
class IronshelfColors {
  IronshelfColors._();

  static const Color background = Color(0xFF0F1115);
  static const Color surface = Color(0xFF1A1D23);
  static const Color surfaceVariant = Color(0xFF22262E);
  static const Color paper = Color(0xFFE8E4DA);
  static const Color teal = Color(0xFF095F73);
  static const Color tealBright = Color(0xFF3BB3C9);
  static const Color muted = Color(0xFF9CA3AF);
  static const Color error = Color(0xFFCF6679);
  static const Color success = Color(0xFF4CAF50);
  static const Color warning = Color(0xFFFFA726);

  // Light theme counterparts
  static const Color lightBackground = Color(0xFFF5F3EE);
  static const Color lightSurface = Color(0xFFFFFFFF);
  static const Color lightSurfaceVariant = Color(0xFFEDE9E0);
  static const Color lightOnBackground = Color(0xFF1A1D23);
  static const Color lightOnSurface = Color(0xFF22262E);
}

/// Build the dark theme (default).
ThemeData buildDarkTheme() {
  final colorScheme = ColorScheme(
    brightness: Brightness.dark,
    primary: IronshelfColors.teal,
    onPrimary: IronshelfColors.paper,
    primaryContainer: IronshelfColors.teal.withValues(alpha: 0.3),
    onPrimaryContainer: IronshelfColors.tealBright,
    secondary: IronshelfColors.tealBright,
    onSecondary: IronshelfColors.background,
    secondaryContainer: IronshelfColors.tealBright.withValues(alpha: 0.2),
    onSecondaryContainer: IronshelfColors.tealBright,
    surface: IronshelfColors.surface,
    onSurface: IronshelfColors.paper,
    surfaceContainerHighest: IronshelfColors.surfaceVariant,
    onSurfaceVariant: IronshelfColors.muted,
    error: IronshelfColors.error,
    onError: IronshelfColors.background,
    outline: IronshelfColors.muted.withValues(alpha: 0.3),
    outlineVariant: IronshelfColors.muted.withValues(alpha: 0.15),
    shadow: Colors.black,
    inverseSurface: IronshelfColors.paper,
    onInverseSurface: IronshelfColors.background,
  );

  return _buildTheme(colorScheme, Brightness.dark);
}

/// Build the light theme.
ThemeData buildLightTheme() {
  final colorScheme = ColorScheme(
    brightness: Brightness.light,
    primary: IronshelfColors.teal,
    onPrimary: Colors.white,
    primaryContainer: IronshelfColors.teal.withValues(alpha: 0.12),
    onPrimaryContainer: IronshelfColors.teal,
    secondary: IronshelfColors.tealBright,
    onSecondary: Colors.white,
    secondaryContainer: IronshelfColors.tealBright.withValues(alpha: 0.15),
    onSecondaryContainer: IronshelfColors.teal,
    surface: IronshelfColors.lightSurface,
    onSurface: IronshelfColors.lightOnSurface,
    surfaceContainerHighest: IronshelfColors.lightSurfaceVariant,
    onSurfaceVariant: IronshelfColors.muted,
    error: const Color(0xFFB00020),
    onError: Colors.white,
    outline: IronshelfColors.muted.withValues(alpha: 0.4),
    outlineVariant: IronshelfColors.muted.withValues(alpha: 0.2),
    shadow: Colors.black26,
    inverseSurface: IronshelfColors.background,
    onInverseSurface: IronshelfColors.paper,
  );

  return _buildTheme(colorScheme, Brightness.light);
}

ThemeData _buildTheme(ColorScheme colorScheme, Brightness brightness) {
  final isDark = brightness == Brightness.dark;
  final scaffoldBackground =
      isDark ? IronshelfColors.background : IronshelfColors.lightBackground;

  final displayFont = GoogleFonts.ebGaramondTextTheme(
    ThemeData(brightness: brightness).textTheme,
  );

  final bodyFont = GoogleFonts.interTextTheme(
    ThemeData(brightness: brightness).textTheme,
  );

  final textTheme = bodyFont.copyWith(
    displayLarge: displayFont.displayLarge?.copyWith(
      color: colorScheme.onSurface,
      fontWeight: FontWeight.w500,
    ),
    displayMedium: displayFont.displayMedium?.copyWith(
      color: colorScheme.onSurface,
      fontWeight: FontWeight.w500,
    ),
    displaySmall: displayFont.displaySmall?.copyWith(
      color: colorScheme.onSurface,
      fontWeight: FontWeight.w500,
    ),
    headlineLarge: displayFont.headlineLarge?.copyWith(
      color: colorScheme.onSurface,
      fontWeight: FontWeight.w500,
    ),
    headlineMedium: displayFont.headlineMedium?.copyWith(
      color: colorScheme.onSurface,
      fontWeight: FontWeight.w500,
    ),
    headlineSmall: displayFont.headlineSmall?.copyWith(
      color: colorScheme.onSurface,
      fontWeight: FontWeight.w500,
    ),
    titleLarge: displayFont.titleLarge?.copyWith(
      color: colorScheme.onSurface,
      fontWeight: FontWeight.w500,
    ),
    titleMedium: bodyFont.titleMedium?.copyWith(
      color: colorScheme.onSurface,
      fontWeight: FontWeight.w500,
    ),
    titleSmall: bodyFont.titleSmall?.copyWith(
      color: colorScheme.onSurface,
      fontWeight: FontWeight.w500,
    ),
    bodyLarge: bodyFont.bodyLarge?.copyWith(color: colorScheme.onSurface),
    bodyMedium: bodyFont.bodyMedium?.copyWith(color: colorScheme.onSurface),
    bodySmall: bodyFont.bodySmall?.copyWith(color: colorScheme.onSurfaceVariant),
    labelLarge: bodyFont.labelLarge?.copyWith(color: colorScheme.onSurface),
    labelMedium: bodyFont.labelMedium?.copyWith(
      color: colorScheme.onSurfaceVariant,
    ),
    labelSmall: bodyFont.labelSmall?.copyWith(
      color: colorScheme.onSurfaceVariant,
    ),
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: scaffoldBackground,
    textTheme: textTheme,
    appBarTheme: AppBarTheme(
      backgroundColor: scaffoldBackground,
      foregroundColor: colorScheme.onSurface,
      elevation: 0,
      scrolledUnderElevation: 1,
      centerTitle: false,
      titleTextStyle: displayFont.titleLarge?.copyWith(
        color: colorScheme.onSurface,
        fontWeight: FontWeight.w500,
        fontSize: 22,
      ),
    ),
    cardTheme: CardThemeData(
      color: colorScheme.surface,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: colorScheme.outlineVariant),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: colorScheme.surfaceContainerHighest,
      labelStyle: textTheme.labelMedium,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      side: BorderSide.none,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colorScheme.surfaceContainerHighest,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: colorScheme.outlineVariant),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: colorScheme.primary, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: colorScheme.error),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: colorScheme.primary,
        foregroundColor: colorScheme.onPrimary,
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: colorScheme.primary,
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        side: BorderSide(color: colorScheme.primary),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: colorScheme.primary,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      ),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: colorScheme.primary,
      foregroundColor: colorScheme.onPrimary,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
    bottomNavigationBarTheme: BottomNavigationBarThemeData(
      backgroundColor: colorScheme.surface,
      selectedItemColor: colorScheme.primary,
      unselectedItemColor: colorScheme.onSurfaceVariant,
      type: BottomNavigationBarType.fixed,
      elevation: 0,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: colorScheme.surface,
      indicatorColor: colorScheme.primaryContainer,
      iconTheme: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return IconThemeData(color: colorScheme.primary);
        }
        return IconThemeData(color: colorScheme.onSurfaceVariant);
      }),
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return textTheme.labelSmall?.copyWith(
            color: colorScheme.primary,
            fontWeight: FontWeight.w600,
          );
        }
        return textTheme.labelSmall?.copyWith(
          color: colorScheme.onSurfaceVariant,
        );
      }),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: colorScheme.inverseSurface,
      contentTextStyle: textTheme.bodyMedium?.copyWith(
        color: colorScheme.onInverseSurface,
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      behavior: SnackBarBehavior.floating,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: colorScheme.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      titleTextStyle: displayFont.titleLarge?.copyWith(
        color: colorScheme.onSurface,
        fontWeight: FontWeight.w500,
      ),
    ),
    dividerTheme: DividerThemeData(
      color: colorScheme.outlineVariant,
      thickness: 1,
    ),
    listTileTheme: ListTileThemeData(
      iconColor: colorScheme.onSurfaceVariant,
      textColor: colorScheme.onSurface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: colorScheme.primary,
      linearTrackColor: colorScheme.outlineVariant,
    ),
  );
}
