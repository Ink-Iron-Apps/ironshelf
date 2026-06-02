import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'providers/auth_provider.dart';
import 'providers/server_provider.dart';
import 'screens/author_detail_screen.dart';
import 'screens/authors_screen.dart';
import 'screens/book_detail_screen.dart';
import 'screens/collection_detail_screen.dart';
import 'screens/collections_screen.dart';
import 'screens/genre_detail_screen.dart';
import 'screens/genres_screen.dart';
import 'screens/home_screen.dart';
import 'screens/library_screen.dart';
import 'screens/login_screen.dart';
import 'screens/reader/reader_screen.dart';
import 'screens/reading_queue_screen.dart';
import 'screens/register_screen.dart';
import 'screens/search_screen.dart';
import 'screens/series_detail_screen.dart';
import 'screens/server_connect_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/shell_screen.dart';
import 'screens/stats_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final isServerConfigured = ref.watch(isServerConfiguredProvider);
  final isAuthenticated = ref.watch(isAuthenticatedProvider);

  return GoRouter(
    initialLocation: '/',
    redirect: (context, state) {
      final currentPath = state.matchedLocation;

      // Public routes that don't require auth
      const publicPaths = [
        '/server-connect',
        '/login',
        '/register',
      ];

      // Not configured → server connect
      if (!isServerConfigured && !publicPaths.contains(currentPath)) {
        return '/server-connect';
      }

      // Configured but not authenticated → login
      if (isServerConfigured &&
          !isAuthenticated &&
          !publicPaths.contains(currentPath)) {
        return '/login';
      }

      // Authenticated but on auth pages → home
      if (isAuthenticated && publicPaths.contains(currentPath)) {
        return '/';
      }

      return null;
    },
    routes: [
      // Auth routes (no shell)
      GoRoute(
        path: '/server-connect',
        builder: (context, state) => const ServerConnectScreen(),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/register',
        builder: (context, state) => const RegisterScreen(),
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
