import 'package:flutter/material.dart';

/// Alphabetical jump sidebar (A-Z) for scrolling lists.
class AlphaSidebar extends StatelessWidget {
  final void Function(String letter) onLetterTap;
  final String? activeLetter;
  final List<String> availableLetters;

  static const List<String> _allLetters = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '#',
  ];

  const AlphaSidebar({
    super.key,
    required this.onLetterTap,
    this.activeLetter,
    this.availableLetters = const [],
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final lettersToShow =
        availableLetters.isEmpty ? _allLetters : _allLetters;

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: lettersToShow.map((letter) {
          final isAvailable = availableLetters.isEmpty ||
              availableLetters.contains(letter);
          final isActive = activeLetter == letter;

          return GestureDetector(
            onTap: isAvailable ? () => onLetterTap(letter) : null,
            child: Container(
              width: 20,
              height: 18,
              alignment: Alignment.center,
              decoration: isActive
                  ? BoxDecoration(
                      color: theme.colorScheme.primary,
                      borderRadius: BorderRadius.circular(4),
                    )
                  : null,
              child: Text(
                letter,
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
                  color: isActive
                      ? theme.colorScheme.onPrimary
                      : isAvailable
                          ? theme.colorScheme.onSurfaceVariant
                          : theme.colorScheme.outlineVariant,
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}
