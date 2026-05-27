import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';

/// Shimmer loading placeholder for various content shapes.
class LoadingSkeleton extends StatelessWidget {
  final double width;
  final double height;
  final BorderRadius borderRadius;

  const LoadingSkeleton({
    super.key,
    this.width = double.infinity,
    this.height = 16,
    this.borderRadius = const BorderRadius.all(Radius.circular(4)),
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Shimmer.fromColors(
      baseColor: isDark ? const Color(0xFF22262E) : const Color(0xFFE0E0E0),
      highlightColor:
          isDark ? const Color(0xFF2A2F38) : const Color(0xFFF5F5F5),
      child: Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: borderRadius,
        ),
      ),
    );
  }
}

/// Grid of skeleton book cards.
class BookGridSkeleton extends StatelessWidget {
  final int count;
  final int crossAxisCount;

  const BookGridSkeleton({
    super.key,
    this.count = 12,
    this.crossAxisCount = 3,
  });

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      padding: const EdgeInsets.all(16),
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: crossAxisCount,
        childAspectRatio: 0.58,
        crossAxisSpacing: 12,
        mainAxisSpacing: 16,
      ),
      itemCount: count,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemBuilder: (context, index) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: LoadingSkeleton(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            const SizedBox(height: 6),
            const LoadingSkeleton(height: 12, width: 100),
            const SizedBox(height: 4),
            const LoadingSkeleton(height: 10, width: 70),
          ],
        );
      },
    );
  }
}

/// List of skeleton tiles.
class ListSkeleton extends StatelessWidget {
  final int count;

  const ListSkeleton({super.key, this.count = 8});

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: count,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemBuilder: (context, index) {
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Row(
            children: [
              LoadingSkeleton(
                width: 44,
                height: 44,
                borderRadius: BorderRadius.circular(22),
              ),
              const SizedBox(width: 14),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    LoadingSkeleton(height: 14, width: 160),
                    SizedBox(height: 6),
                    LoadingSkeleton(height: 10, width: 90),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// Horizontal scroll skeleton for continue reading.
class HorizontalBookSkeleton extends StatelessWidget {
  final int count;

  const HorizontalBookSkeleton({super.key, this.count = 5});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 200,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: count,
        itemBuilder: (context, index) {
          return Padding(
            padding: const EdgeInsets.only(right: 12),
            child: SizedBox(
              width: 120,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  LoadingSkeleton(
                    height: 160,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  const SizedBox(height: 6),
                  const LoadingSkeleton(height: 10, width: 90),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
