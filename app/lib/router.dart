import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'providers/auth_provider.dart';
import 'providers/cloud_provider.dart';
import 'providers/server_provider.dart';
import 'screens/author_detail_screen.dart';
import 'screens/authors_screen.dart';
import 'screens/book_detail_screen.dart';
import 'screens/cloud_login_screen.dart';
import 'screens/cloud_servers_screen.dart';
import 'screens/collection_detail_screen.dart';
import 'screens/collections_screen.dart';
import 'screens/genre_detail_screen.dart';
import 'screens/genres_screen.dart';
import 'screens/home_screen.dart';
import 'screens/library_screen.dart';
import 'screens/reader/reader_screen.dart';
import 'screens/reading_queue_screen.dart';
import 'screens/search_screen.dart';
import 'screens/series_detail_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/shell_screen.dart';
import 'screens/stats_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final hasCloud = ref.watch(cloudConfiguredProvider);
  final hasServer = ref.watch(isServerConfiguredProvider) &&
      ref.watch(isAuthenticatedProvider);

  return GoRouter(
    initialLocation: '/',
    redirect: (context, state) {
      final path = state.matchedLocation;
      const loginPath = '/cloud-login';
      const pickerPath = '/cloud-servers';

      // The app is cloud-only: sign in to the cloud first.
      if (!hasCloud) {
        return path == loginPath ? null : loginPath;
      }
      // Signed in to the cloud but no server connected → pick one.
      if (!hasServer) {
        return path == pickerPath ? null : pickerPath;
      }
      // Fully connected. Keep users off the login page; the picker stays
      // reachable so they can switch servers.
      if (path == loginPath) return '/';
      return null;
    },
    routes: [
      // Cloud onboarding (no shell)
      GoRoute(
        path: '/cloud-login',
        builder: (context, state) => const CloudLoginScreen(),
      ),
      GoRoute(
        path: '/cloud-servers',
        builder: (context, state) => const CloudServersScreen(),
      ),

      // Main app with bottom navigation shell
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) {
          return ShellScreen(navigationShell: navigationShell);
        },
        branches: [
          // Home tab
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/',
                builder: (context, state) => const HomeScreen(),
              ),
            ],
          ),
          // Libraries tab
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/libraries',
                builder: (context, state) => const LibraryListScreen(),
              ),
            ],
          ),
          // Search tab
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/search',
                builder: (context, state) => const SearchScreen(),
              ),
            ],
          ),
          // Collections tab
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/collections',
                builder: (context, state) => const CollectionsScreen(),
              ),
            ],
          ),
          // Settings tab
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/settings',
                builder: (context, state) => const SettingsScreen(),
              ),
            ],
          ),
        ],
      ),

      // Detail routes (no bottom nav shell — full screen)
      GoRoute(
        path: '/library/:id',
        builder: (context, state) {
          final libraryId = state.pathParameters['id']!;
          return AuthorsScreen(libraryId: libraryId);
        },
        routes: [
          GoRoute(
            path: 'authors',
            builder: (context, state) {
              final libraryId = state.pathParameters['id']!;
              return AuthorsScreen(libraryId: libraryId);
            },
          ),
          GoRoute(
            path: 'genres',
            builder: (context, state) => const GenresScreen(),
          ),
        ],
      ),
      GoRoute(
        path: '/author/:id',
        builder: (context, state) {
          final authorId =
              int.tryParse(state.pathParameters['id'] ?? '') ?? 0;
          return AuthorDetailScreen(authorId: authorId);
        },
      ),
      GoRoute(
        path: '/series/:id',
        builder: (context, state) {
          final seriesId =
              int.tryParse(state.pathParameters['id'] ?? '') ?? 0;
          return SeriesDetailScreen(seriesId: seriesId);
        },
      ),
      GoRoute(
        path: '/book/:id',
        builder: (context, state) {
          final bookId =
              int.tryParse(state.pathParameters['id'] ?? '') ?? 0;
          return BookDetailScreen(bookId: bookId);
        },
      ),
      GoRoute(
        path: '/read/:id/:format',
        builder: (context, state) {
          final bookId =
              int.tryParse(state.pathParameters['id'] ?? '') ?? 0;
          final format = state.pathParameters['format'] ?? 'epub';
          return ReaderScreen(bookId: bookId, format: format);
        },
      ),
      GoRoute(
        path: '/genre/:name',
        builder: (context, state) {
          final genreName = state.pathParameters['name']!;
          return GenreDetailScreen(genreName: genreName);
        },
      ),
      GoRoute(
        path: '/collection/:id',
        builder: (context, state) {
          final collectionId = state.pathParameters['id']!;
          return CollectionDetailScreen(collectionId: collectionId);
        },
      ),
      GoRoute(
        path: '/queue',
        builder: (context, state) => const ReadingQueueScreen(),
      ),
      GoRoute(
        path: '/stats',
        builder: (context, state) => const StatsScreen(),
      ),
    ],
  );
});
