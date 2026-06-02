import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/reading_provider.dart';
import '../providers/server_provider.dart';
import '../theme.dart';
import '../widgets/error_state.dart';

/// User activity provider.
final userActivityProvider =
    FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.getUserActivity(limit: 50);
});

class StatsScreen extends ConsumerWidget {
  const StatsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final activityAsync = ref.watch(userActivityProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Reading Stats')),
      body: activityAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => ErrorState(
          message: 'Could not load activity',
          onRetry: () => ref.invalidate(userActivityProvider),
        ),
        data: (activity) {
          return CustomScrollView(
            slivers: [
              // Reading goal + lifetime stats
              const SliverToBoxAdapter(child: _ReadingGoalCard()),
              const SliverToBoxAdapter(child: _PersonalStatsGrid()),

              // Recent activity header
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                  child: Text('Your Reading Activity',
                      style: theme.textTheme.titleMedium),
                ),
              ),

              // Recent activity
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                  child: Text('Recent Activity',
                      style: theme.textTheme.titleSmall),
                ),
              ),

              if (activity.isEmpty)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.all(32),
                    child: Center(
                      child: Column(
                        children: [
                          Icon(
                            Icons.history_rounded,
                            size: 48,
                            color: theme.colorScheme.onSurfaceVariant
                                .withValues(alpha: 0.4),
                          ),
                          const SizedBox(height: 12),
                          Text(
                            'No activity yet',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Start reading to track your progress here.',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

              SliverList(
                delegate: SliverChildBuilderDelegate(
                  (context, index) {
                    final entry = activity[index];
                    final action = entry['action'] as String? ?? 'unknown';
                    final createdAt = entry['created_at'] as String? ?? '';

                    return ListTile(
                      leading: Icon(
                        _activityIcon(action),
                        color: theme.colorScheme.onSurfaceVariant,
                        size: 20,
                      ),
                      title: Text(_activityLabel(action)),
                      subtitle: Text(
                        createdAt,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    );
                  },
                  childCount: activity.length,
                ),
              ),

              const SliverPadding(padding: EdgeInsets.only(bottom: 32)),
            ],
          );
        },
      ),
    );
  }

  IconData _activityIcon(String action) {
    switch (action) {
      case 'book_opened':
        return Icons.menu_book_rounded;
      case 'progress_updated':
        return Icons.update_rounded;
      case 'bookmark_created':
        return Icons.bookmark_add_rounded;
      case 'collection_created':
        return Icons.playlist_add_rounded;
      default:
        return Icons.circle_outlined;
    }
  }

  String _activityLabel(String action) {
    switch (action) {
      case 'book_opened':
        return 'Opened a book';
      case 'progress_updated':
        return 'Updated reading progress';
      case 'bookmark_created':
        return 'Added a bookmark';
      case 'collection_created':
        return 'Created a collection';
      default:
        return action.replaceAll('_', ' ');
    }
  }
}

class _StatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: IronshelfColors.tealBright, size: 24),
            const SizedBox(height: 12),
            Text(
              value,
              style: theme.textTheme.headlineMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Yearly reading goal card with progress + set/update action.
class _ReadingGoalCard extends ConsumerWidget {
  const _ReadingGoalCard();

  Future<void> _setGoal(BuildContext context, WidgetRef ref, int current) async {
    final controller = TextEditingController(
        text: current > 0 ? current.toString() : '');
    final value = await showDialog<int>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Set reading goal'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Books this year'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(
                dialogContext, int.tryParse(controller.text.trim())),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (value == null || value <= 0) return;
    // Use the current calendar year; the server defaults the query to it too.
    final year = DateTime.now().year;
    await ref.read(apiServiceProvider).setReadingGoal(year, value);
    ref.invalidate(readingGoalProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final goalAsync = ref.watch(readingGoalProvider);

    return goalAsync.maybeWhen(
      orElse: () => const SizedBox.shrink(),
      data: (goal) {
        final target = goal?.target ?? 0;
        final completed = goal?.completed ?? 0;
        final percent = goal != null && goal.target > 0
            ? (goal.completed / goal.target).clamp(0.0, 1.0)
            : 0.0;
        return Card(
          margin: const EdgeInsets.fromLTRB(16, 16, 16, 4),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Reading goal', style: theme.textTheme.titleSmall),
                    TextButton(
                      onPressed: () => _setGoal(context, ref, target),
                      child: Text(target > 0 ? 'Edit' : 'Set goal'),
                    ),
                  ],
                ),
                if (target > 0) ...[
                  const SizedBox(height: 8),
                  LinearProgressIndicator(value: percent),
                  const SizedBox(height: 6),
                  Text('$completed of $target books this year',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      )),
                ] else
                  Text('Set a yearly goal to track your reading.',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      )),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Lifetime / yearly reading stats grid from /me/stats.
class _PersonalStatsGrid extends ConsumerWidget {
  const _PersonalStatsGrid();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statsAsync = ref.watch(personalStatsProvider);
    return statsAsync.maybeWhen(
      orElse: () => const SizedBox.shrink(),
      data: (stats) {
        final cards = <Widget>[
          _StatCard(
            icon: Icons.auto_stories_rounded,
            label: 'Books read',
            value: '${stats['total_books_read'] ?? 0}',
          ),
          _StatCard(
            icon: Icons.calendar_today_rounded,
            label: 'This year',
            value: '${stats['books_completed_this_year'] ?? 0}',
          ),
          _StatCard(
            icon: Icons.local_fire_department_rounded,
            label: 'Current streak',
            value: '${stats['current_streak'] ?? 0}',
          ),
          _StatCard(
            icon: Icons.emoji_events_rounded,
            label: 'Longest streak',
            value: '${stats['longest_streak'] ?? 0}',
          ),
        ];
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            childAspectRatio: 1.6,
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
            children: cards,
          ),
        );
      },
    );
  }
}
