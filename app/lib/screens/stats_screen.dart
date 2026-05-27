import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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
              // Stats cards
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Your Reading Activity',
                          style: theme.textTheme.titleMedium),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(
                            child: _StatCard(
                              icon: Icons.menu_book_rounded,
                              label: 'Activities',
                              value: '${activity.length}',
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
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
