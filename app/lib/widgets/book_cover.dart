import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/book_provider.dart';
import '../theme.dart';

/// Displays a book cover image with placeholder and error states.
class BookCover extends ConsumerWidget {
  final int bookId;
  final bool hasCover;
  final String? title;
  final double? width;
  final double? height;
  final BorderRadius borderRadius;
  final String? heroTag;

  const BookCover({
    super.key,
    required this.bookId,
    this.hasCover = true,
    this.title,
    this.width,
    this.height,
    this.borderRadius = const BorderRadius.all(Radius.circular(8)),
    this.heroTag,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final coverUrl = ref.watch(coverUrlProvider(bookId));
    final authHeaders = ref.watch(authHeadersProvider);

    Widget image;

    if (!hasCover) {
      image = _PlaceholderCover(
        title: title,
        width: width,
        height: height,
        borderRadius: borderRadius,
      );
    } else {
      image = ClipRRect(
        borderRadius: borderRadius,
        child: CachedNetworkImage(
          imageUrl: coverUrl,
          httpHeaders: authHeaders,
          width: width,
          height: height,
          fit: BoxFit.cover,
          placeholder: (context, url) => _ShimmerPlaceholder(
            width: width,
            height: height,
            borderRadius: borderRadius,
          ),
          errorWidget: (context, url, error) => _PlaceholderCover(
            title: title,
            width: width,
            height: height,
            borderRadius: borderRadius,
          ),
        ),
      );
    }

    if (heroTag != null) {
      return Hero(tag: heroTag!, child: image);
    }

    return image;
  }
}

class _PlaceholderCover extends StatelessWidget {
  final String? title;
  final double? width;
  final double? height;
  final BorderRadius borderRadius;

  const _PlaceholderCover({
    this.title,
    this.width,
    this.height,
    this.borderRadius = const BorderRadius.all(Radius.circular(8)),
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        borderRadius: borderRadius,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            IronshelfColors.teal.withValues(alpha: 0.3),
            IronshelfColors.teal.withValues(alpha: 0.15),
          ],
        ),
        border: Border.all(
          color: theme.colorScheme.outlineVariant,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.menu_book_rounded,
              size: (width ?? 80) * 0.3,
              color: IronshelfColors.tealBright.withValues(alpha: 0.5),
            ),
            if (title != null) ...[
              const SizedBox(height: 4),
              Text(
                title!,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ShimmerPlaceholder extends StatefulWidget {
  final double? width;
  final double? height;
  final BorderRadius borderRadius;

  const _ShimmerPlaceholder({
    this.width,
    this.height,
    this.borderRadius = const BorderRadius.all(Radius.circular(8)),
  });

  @override
  State<_ShimmerPlaceholder> createState() => _ShimmerPlaceholderState();
}

class _ShimmerPlaceholderState extends State<_ShimmerPlaceholder>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(
            borderRadius: widget.borderRadius,
            gradient: LinearGradient(
              begin: Alignment(-1.0 + 2.0 * _controller.value, 0),
              end: Alignment(1.0 + 2.0 * _controller.value, 0),
              colors: [
                IronshelfColors.surface,
                IronshelfColors.surfaceVariant,
                IronshelfColors.surface,
              ],
            ),
          ),
        );
      },
    );
  }
}
