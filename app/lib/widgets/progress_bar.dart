import 'package:flutter/material.dart';
import '../theme.dart';

/// Reading progress indicator bar.
class ReadingProgressBar extends StatelessWidget {
  final double percent;
  final double height;
  final bool showLabel;
  final BorderRadius? borderRadius;

  const ReadingProgressBar({
    super.key,
    required this.percent,
    this.height = 4,
    this.showLabel = false,
    this.borderRadius,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final clampedPercent = percent.clamp(0.0, 1.0);
    final percentDisplay = (clampedPercent * 100).round();

    if (showLabel) {
      return Row(
        children: [
          Expanded(
            child: _bar(theme, clampedPercent),
          ),
          const SizedBox(width: 6),
          Text(
            '$percentDisplay%',
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              fontSize: 10,
            ),
          ),
        ],
      );
    }

    return _bar(theme, clampedPercent);
  }

  Widget _bar(ThemeData theme, double clampedPercent) {
    return ClipRRect(
      borderRadius: borderRadius ?? BorderRadius.circular(height / 2),
      child: SizedBox(
        height: height,
        child: LinearProgressIndicator(
          value: clampedPercent,
          backgroundColor: theme.colorScheme.outlineVariant,
          valueColor: AlwaysStoppedAnimation<Color>(
            clampedPercent >= 1.0
                ? IronshelfColors.success
                : IronshelfColors.tealBright,
          ),
        ),
      ),
    );
  }
}
