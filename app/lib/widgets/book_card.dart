import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/book.dart';
import '../providers/reading_provider.dart';
import 'book_cover.dart';
import 'progress_bar.dart';

/// Book card for grid layout.
class BookCard extends ConsumerWidget {
  final Book book;
  final String? authorName;
  final double? progressPercent;
  final VoidCallback? onTap;

  const BookCard({
    super.key,
    required this.book,
    this.authorName,
    this.progressPercent,
    this.onTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final states = ref.watch(readingStatesProvider).valueOrNull;
    final status = states?.statusFor(book.id.toString());
    // Use an explicitly-passed percent (e.g. continue-reading), else the
    // cached reading-state percent.
    final overlayPercent = progressPercent ??
        states?.inProgress[book.id.toString()];

    return GestureDetector(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Stack(
              children: [
                BookCover(
                  bookId: book.id,
                  hasCover: book.hasCover,
                  title: book.title,
                  width: double.infinity,
                  height: double.infinity,
                  heroTag: 'book_cover_${book.id}',
                ),
                // Series index badge
                if (book.seriesIndex != null)
                  Positioned(
                    top: 6,
                    right: 6,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.primary,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        '#${_formatSeriesIndex(book.seriesIndex!)}',
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: theme.colorScheme.onPrimary,
                          fontWeight: FontWeight.w600,
                          fontSize: 10,
                        ),
                      ),
                    ),
                  ),
                // Finished badge (top-left so it doesn't clash with series badge)
                if (status == 'finished')
                  Positioned(
                    top: 6,
                    left: 6,
                    child: Container(
                      padding: const EdgeInsets.all(3),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.primary,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(Icons.check,
                          size: 13, color: theme.colorScheme.onPrimary),
                    ),
                  ),
                // Progress overlay (in-progress books)
                if (status != 'finished' &&
                    overlayPercent != null &&
                    overlayPercent > 0)
                  Positioned(
                    bottom: 0,
                    left: 0,
                    right: 0,
                    child: ReadingProgressBar(
                      percent: overlayPercent,
                      height: 3,
                      borderRadius: const BorderRadius.only(
                        bottomLeft: Radius.circular(8),
                        bottomRight: Radius.circular(8),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 6),
          Text(
            book.title,
            style: theme.textTheme.bodySmall?.copyWith(
              fontWeight: FontWeight.w500,
            ),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          if (authorName != null)
            Text(
              authorName!,
              style: theme.textTheme.labelSmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
        ],
      ),
    );
  }

  String _formatSeriesIndex(double index) {
    if (index == index.roundToDouble()) {
      return index.toInt().toString();
    }
    return index.toString();
  }
}

/// Book list tile for list layout.
class BookListTile extends ConsumerWidget {
  final Book book;
  final String? authorName;
  final double? progressPercent;
  final VoidCallback? onTap;
  final Widget? trailing;

  const BookListTile({
    super.key,
    required this.book,
    this.authorName,
    this.progressPercent,
    this.onTap,
    this.trailing,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final states = ref.watch(readingStatesProvider).valueOrNull;
    final status = states?.statusFor(book.id.toString());
    final overlayPercent =
        progressPercent ?? states?.inProgress[book.id.toString()];

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
        child: Row(
          children: [
            BookCover(
              bookId: book.id,
              hasCover: book.hasCover,
              title: book.title,
              width: 48,
              height: 70,
              heroTag: 'book_cover_${book.id}',
              borderRadius: BorderRadius.circular(6),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    book.title,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w500,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (authorName != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      authorName!,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  if (book.seriesIndex != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      'Book #${_formatSeriesIndex(book.seriesIndex!)}',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.primary,
                      ),
                    ),
                  ],
                  if (status == 'finished') ...[
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Icon(Icons.check_circle,
                            size: 13, color: theme.colorScheme.primary),
                        const SizedBox(width: 4),
                        Text('Read',
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: theme.colorScheme.primary,
                            )),
                      ],
                    ),
                  ] else if (overlayPercent != null && overlayPercent > 0) ...[
                    const SizedBox(height: 4),
                    ReadingProgressBar(
                      percent: overlayPercent,
                      height: 3,
                      showLabel: true,
                    ),
                  ],
                ],
              ),
            ),
            if (trailing != null) ...[
              const SizedBox(width: 8),
              trailing!,
            ],
          ],
        ),
      ),
    );
  }

  String _formatSeriesIndex(double index) {
    if (index == index.roundToDouble()) {
      return index.toInt().toString();
    }
    return index.toString();
  }
}
