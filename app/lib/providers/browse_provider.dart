import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/author.dart';
import '../models/book.dart';
import '../services/api_service.dart';
import 'server_provider.dart';

/// Authors list for a specific library.
final authorsProvider = FutureProvider.family
    .autoDispose<PaginatedResponse<Author>, AuthorsRequest>((ref, request) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.getAuthors(
    request.libraryId,
    page: request.page,
    perPage: request.perPage,
    sort: request.sort,
    direction: request.direction,
  );
});

class AuthorsRequest {
  final String libraryId;
  final int page;
  final int perPage;
  final String? sort;
  final String? direction;

  const AuthorsRequest({
    required this.libraryId,
    this.page = 1,
    this.perPage = 50,
    this.sort,
    this.direction,
  });

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AuthorsRequest &&
          libraryId == other.libraryId &&
          page == other.page &&
          perPage == other.perPage &&
          sort == other.sort &&
          direction == other.direction;

  @override
  int get hashCode => Object.hash(libraryId, page, perPage, sort, direction);
}

/// Author detail.
final authorDetailProvider =
    FutureProvider.family.autoDispose<AuthorDetail, int>((ref, authorId) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.getAuthorDetail(authorId);
});

/// Standalone books for an author.
final authorStandaloneBooksProvider =
    FutureProvider.family.autoDispose<List<Book>, int>((ref, authorId) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.getAuthorStandaloneBooks(authorId);
});

/// Series detail with books.
final seriesDetailProvider =
    FutureProvider.family.autoDispose<SeriesDetail, int>((ref, seriesId) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.getSeriesDetail(seriesId);
});

/// Library books with pagination.
final libraryBooksProvider = FutureProvider.family
    .autoDispose<PaginatedResponse<Book>, LibraryBooksRequest>((ref, request) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.getLibraryBooks(
    request.libraryId,
    page: request.page,
    perPage: request.perPage,
    sort: request.sort,
    direction: request.direction,
    query: request.query,
    tag: request.tag,
  );
});

class LibraryBooksRequest {
  final String libraryId;
  final int page;
  final int perPage;
  final String? sort;
  final String? direction;
  final String? query;
  final String? tag;

  const LibraryBooksRequest({
    required this.libraryId,
    this.page = 1,
    this.perPage = 30,
    this.sort,
    this.direction,
    this.query,
    this.tag,
  });

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is LibraryBooksRequest &&
          libraryId == other.libraryId &&
          page == other.page &&
          perPage == other.perPage &&
          sort == other.sort &&
          direction == other.direction &&
          query == other.query &&
          tag == other.tag;

  @override
  int get hashCode =>
      Object.hash(libraryId, page, perPage, sort, direction, query, tag);
}
