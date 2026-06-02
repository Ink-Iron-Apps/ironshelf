import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/auth_provider.dart';
import '../providers/reading_provider.dart';
import '../providers/server_provider.dart';
import '../services/api_service.dart';

/// Community rating + the user's own rating (tap stars to set). Ratings are
/// 1–10 on the server; shown as 5 stars (each star = 2 points).
class BookRatingsBar extends ConsumerWidget {
  final String bookId;
  const BookRatingsBar({super.key, required this.bookId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final ratingsAsync = ref.watch(bookRatingsProvider(bookId));

    return ratingsAsync.when(
      loading: () => const SizedBox(height: 28),
      error: (_, __) => const SizedBox.shrink(),
      data: (ratings) {
        final userStars = (ratings.userRating ?? 0) / 2;
        return Column(
          children: [
            if (ratings.count > 0)
              Text(
                '${ratings.average?.toStringAsFixed(1) ?? '–'} / 10 · '
                '${ratings.count} rating${ratings.count == 1 ? '' : 's'}',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text('Your rating: ',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    )),
                for (var i = 1; i <= 5; i++)
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    constraints: const BoxConstraints(),
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    icon: Icon(
                      i <= userStars ? Icons.star : Icons.star_border,
                      color: theme.colorScheme.primary,
                      size: 22,
                    ),
                    onPressed: () async {
                      await ref
                          .read(apiServiceProvider)
                          .setBookRating(bookId, i * 2);
                      ref.invalidate(bookRatingsProvider(bookId));
                    },
                  ),
              ],
            ),
          ],
        );
      },
    );
  }
}

/// Reviews list + write/edit/delete for the current user's own review.
class BookReviewsSection extends ConsumerWidget {
  final String bookId;
  const BookReviewsSection({super.key, required this.bookId});

  Future<void> _compose(
    BuildContext context,
    WidgetRef ref, {
    Review? existing,
  }) async {
    final titleController = TextEditingController(text: existing?.title ?? '');
    final bodyController = TextEditingController(text: existing?.body ?? '');
    var spoilers = existing?.containsSpoilers ?? false;

    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 16,
          bottom: MediaQuery.of(sheetContext).viewInsets.bottom + 16,
        ),
        child: StatefulBuilder(
          builder: (context, setSheetState) => Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(existing == null ? 'Write a review' : 'Edit review',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 12),
              TextField(
                controller: titleController,
                decoration: const InputDecoration(labelText: 'Title'),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: bodyController,
                maxLines: 5,
                decoration: const InputDecoration(
                  labelText: 'Your thoughts',
                  alignLabelWithHint: true,
                ),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Contains spoilers'),
                value: spoilers,
                onChanged: (v) => setSheetState(() => spoilers = v),
              ),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: () => Navigator.pop(sheetContext, true),
                child: const Text('Save review'),
              ),
            ],
          ),
        ),
      ),
    );

    if (saved != true) return;
    final api = ref.read(apiServiceProvider);
    try {
      if (existing == null) {
        await api.createReview(bookId,
            title: titleController.text.trim(),
            body: bodyController.text.trim(),
            containsSpoilers: spoilers);
      } else {
        await api.updateReview(existing.id,
            title: titleController.text.trim(),
            body: bodyController.text.trim(),
            containsSpoilers: spoilers);
      }
      ref.invalidate(bookReviewsProvider(bookId));
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Could not save review: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final reviewsAsync = ref.watch(bookReviewsProvider(bookId));
    final currentUserId = ref.watch(authProvider).user?.userId;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Reviews', style: theme.textTheme.titleSmall),
            TextButton.icon(
              onPressed: () => _compose(context, ref),
              icon: const Icon(Icons.rate_review_outlined, size: 18),
              label: const Text('Write'),
            ),
          ],
        ),
        reviewsAsync.when(
          loading: () =>
              const Padding(padding: EdgeInsets.all(8), child: SizedBox()),
          error: (_, __) => Text('Could not load reviews',
              style: theme.textTheme.bodySmall),
          data: (reviews) {
            if (reviews.isEmpty) {
              return Text('No reviews yet — be the first.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ));
            }
            return Column(
              children: reviews
                  .map((review) => _ReviewTile(
                        review: review,
                        isMine: review.userId == currentUserId,
                        onEdit: () =>
                            _compose(context, ref, existing: review),
                        onDelete: () async {
                          await ref
                              .read(apiServiceProvider)
                              .deleteReview(review.id);
                          ref.invalidate(bookReviewsProvider(bookId));
                        },
                      ))
                  .toList(),
            );
          },
        ),
      ],
    );
  }
}

class _ReviewTile extends StatefulWidget {
  final Review review;
  final bool isMine;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _ReviewTile({
    required this.review,
    required this.isMine,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  State<_ReviewTile> createState() => _ReviewTileState();
}

class _ReviewTileState extends State<_ReviewTile> {
  bool _revealed = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final review = widget.review;
    final hidden = review.containsSpoilers && !_revealed;

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    review.title.isEmpty ? review.username : review.title,
                    style: theme.textTheme.titleSmall,
                  ),
                ),
                if (widget.isMine) ...[
                  InkWell(
                    onTap: widget.onEdit,
                    child: const Padding(
                      padding: EdgeInsets.all(4),
                      child: Icon(Icons.edit, size: 16),
                    ),
                  ),
                  InkWell(
                    onTap: widget.onDelete,
                    child: const Padding(
                      padding: EdgeInsets.all(4),
                      child: Icon(Icons.delete_outline, size: 16),
                    ),
                  ),
                ],
              ],
            ),
            Text('by ${review.username}',
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                )),
            const SizedBox(height: 6),
            if (hidden)
              TextButton(
                onPressed: () => setState(() => _revealed = true),
                child: const Text('Show spoiler review'),
              )
            else
              Text(review.body, style: theme.textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }
}
