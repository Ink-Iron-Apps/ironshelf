import 'package:flutter/material.dart';

/// Interactive star rating widget.
/// Server uses 1-10 scale; this displays as 5 stars (half-star precision).
class RatingStars extends StatelessWidget {
  /// Rating on 1-10 scale (null = unrated).
  final int? rating;

  /// Callback when user taps a star (value is 1-10).
  final ValueChanged<int>? onChanged;

  final double starSize;
  final Color? activeColor;
  final Color? inactiveColor;

  const RatingStars({
    super.key,
    this.rating,
    this.onChanged,
    this.starSize = 24,
    this.activeColor,
    this.inactiveColor,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final active = activeColor ?? Colors.amber;
    final inactive = inactiveColor ?? theme.colorScheme.outlineVariant;
    final starValue = (rating ?? 0) / 2.0; // Convert 1-10 to 0-5

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(5, (index) {
        final starNumber = index + 1;
        final isFull = starValue >= starNumber;
        final isHalf = !isFull && starValue >= starNumber - 0.5;

        IconData iconData;
        Color color;

        if (isFull) {
          iconData = Icons.star_rounded;
          color = active;
        } else if (isHalf) {
          iconData = Icons.star_half_rounded;
          color = active;
        } else {
          iconData = Icons.star_outline_rounded;
          color = inactive;
        }

        return GestureDetector(
          onTap: onChanged != null
              ? () => onChanged!(starNumber * 2)
              : null,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 1),
            child: Icon(iconData, size: starSize, color: color),
          ),
        );
      }),
    );
  }
}

/// Compact rating display (text only).
class RatingText extends StatelessWidget {
  final int? rating;

  const RatingText({super.key, this.rating});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (rating == null || rating == 0) {
      return Text(
        'Not rated',
        style: theme.textTheme.bodySmall?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      );
    }

    final stars = rating! / 2.0;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.star_rounded, size: 14, color: Colors.amber),
        const SizedBox(width: 2),
        Text(
          stars.toStringAsFixed(stars == stars.roundToDouble() ? 0 : 1),
          style: theme.textTheme.bodySmall?.copyWith(
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}
