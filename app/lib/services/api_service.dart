import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import '../models/author.dart';
import '../models/book.dart';
import '../models/library.dart';
import '../models/series.dart';
import '../models/server_config.dart';

/// Paginated response wrapper matching the server's Paginated<T> envelope.
class PaginatedResponse<T> {
  final List<T> items;
  final int page;
  final int perPage;
  final int totalItems;
  final int totalPages;

  const PaginatedResponse({
    required this.items,
    required this.page,
    required this.perPage,
    required this.totalItems,
    required this.totalPages,
  });

  factory PaginatedResponse.fromJson(
    Map<String, dynamic> json,
    T Function(Map<String, dynamic>) fromItem,
  ) {
    return PaginatedResponse(
      items: (json['items'] as List? ?? [])
          .map((item) => fromItem(item as Map<String, dynamic>))
          .toList(),
      page: json['page'] as int? ?? 1,
      perPage: json['per_page'] as int? ?? 20,
      totalItems: json['total_items'] as int? ?? 0,
      totalPages: json['total_pages'] as int? ?? 1,
    );
  }

  bool get hasMore => page < totalPages;
}

/// Search results matching the server's SearchResponse.
class SearchResults {
  final String query;
  final List<AuthorSearchResult> authors;
  final List<SeriesSearchResult> seriesResults;
  final List<BookSearchResult> books;
  final int total;
  final bool indexed;

  const SearchResults({
    required this.query,
    required this.authors,
    required this.seriesResults,
    required this.books,
    required this.total,
    required this.indexed,
  });

  factory SearchResults.fromJson(Map<String, dynamic> json) {
    final results = json['results'] as Map<String, dynamic>? ?? {};
    return SearchResults(
      query: json['query'] as String? ?? '',
      authors: (results['authors'] as List? ?? [])
          .map((authorJson) =>
              AuthorSearchResult.fromJson(authorJson as Map<String, dynamic>))
          .toList(),
      seriesResults: (results['series'] as List? ?? [])
          .map((seriesJson) =>
              SeriesSearchResult.fromJson(seriesJson as Map<String, dynamic>))
          .toList(),
      books: (results['books'] as List? ?? [])
          .map((bookJson) =>
              BookSearchResult.fromJson(bookJson as Map<String, dynamic>))
          .toList(),
      total: json['total'] as int? ?? 0,
      indexed: json['indexed'] as bool? ?? false,
    );
  }

  bool get isEmpty => authors.isEmpty && seriesResults.isEmpty && books.isEmpty;
}

class AuthorSearchResult {
  final int id;
  final String name;
  final String sortName;
  final int bookCount;
  final int seriesCount;
  final String libraryId;

  const AuthorSearchResult({
    required this.id,
    required this.name,
    required this.sortName,
    required this.bookCount,
    required this.seriesCount,
    required this.libraryId,
  });

  factory AuthorSearchResult.fromJson(Map<String, dynamic> json) {
    return AuthorSearchResult(
      id: (json['id'] as num).toInt(),
      name: json['name'] as String? ?? '',
      sortName: json['sort_name'] as String? ?? '',
      bookCount: (json['book_count'] as num?)?.toInt() ?? 0,
      seriesCount: (json['series_count'] as num?)?.toInt() ?? 0,
      libraryId: json['library_id']?.toString() ?? '',
    );
  }
}

class SeriesSearchResult {
  final int id;
  final String name;
  final String sortName;
  final int bookCount;
  final String libraryId;

  const SeriesSearchResult({
    required this.id,
    required this.name,
    required this.sortName,
    required this.bookCount,
    required this.libraryId,
  });

  factory SeriesSearchResult.fromJson(Map<String, dynamic> json) {
    return SeriesSearchResult(
      id: (json['id'] as num).toInt(),
      name: json['name'] as String? ?? '',
      sortName: json['sort_name'] as String? ?? '',
      bookCount: (json['book_count'] as num?)?.toInt() ?? 0,
      libraryId: json['library_id']?.toString() ?? '',
    );
  }
}

class BookSearchResult {
  final int id;
  final String title;
  final String sortTitle;
  final bool hasCover;
  final List<String> tags;
  final String libraryId;
  final double? score;

  const BookSearchResult({
    required this.id,
    required this.title,
    required this.sortTitle,
    required this.hasCover,
    required this.tags,
    required this.libraryId,
    this.score,
  });

  factory BookSearchResult.fromJson(Map<String, dynamic> json) {
    return BookSearchResult(
      id: (json['id'] as num).toInt(),
      title: json['title'] as String? ?? '',
      sortTitle: json['sort_title'] as String? ?? '',
      hasCover: json['has_cover'] as bool? ?? false,
      tags: (json['tags'] as List?)
              ?.map((element) => element.toString())
              .toList() ??
          [],
      libraryId: json['library_id']?.toString() ?? '',
      score: (json['score'] as num?)?.toDouble(),
    );
  }
}

/// Server info from /api/v1/server/info.
class ServerInfo {
  final String name;
  final String version;
  final List<String> features;
  final bool registrationOpen;
  final bool inviteRequired;

  const ServerInfo({
    required this.name,
    required this.version,
    required this.features,
    required this.registrationOpen,
    required this.inviteRequired,
  });

  factory ServerInfo.fromJson(Map<String, dynamic> json) {
    return ServerInfo(
      name: json['name'] as String? ?? 'Ironshelf',
      version: json['version'] as String? ?? '0.0.0',
      features: (json['features'] as List? ?? [])
          .map((element) => element.toString())
          .toList(),
      registrationOpen: json['registration_open'] as bool? ?? false,
      inviteRequired: json['invite_required'] as bool? ?? true,
    );
  }
}

/// Auth response from login/register.
class AuthResponse {
  final String userId;
  final String username;
  final bool isOwner;
  final String sessionId;

  const AuthResponse({
    required this.userId,
    required this.username,
    required this.isOwner,
    required this.sessionId,
  });

  factory AuthResponse.fromJson(Map<String, dynamic> json) {
    return AuthResponse(
      userId: json['user_id']?.toString() ?? '',
      username: json['username'] as String? ?? '',
      isOwner: json['is_owner'] as bool? ?? false,
      sessionId: json['session_id']?.toString() ?? '',
    );
  }
}

/// Current user info.
class UserInfo {
  final String userId;
  final String username;
  final bool isOwner;

  const UserInfo({
    required this.userId,
    required this.username,
    required this.isOwner,
  });

  factory UserInfo.fromJson(Map<String, dynamic> json) {
    return UserInfo(
      userId: json['user_id']?.toString() ?? '',
      username: json['username'] as String? ?? '',
      isOwner: json['is_owner'] as bool? ?? false,
    );
  }
}

/// API key summary.
class ApiKeySummary {
  final String id;
  final String prefix;
  final String label;
  final String createdAt;

  const ApiKeySummary({
    required this.id,
    required this.prefix,
    required this.label,
    required this.createdAt,
  });

  factory ApiKeySummary.fromJson(Map<String, dynamic> json) {
    return ApiKeySummary(
      id: json['id']?.toString() ?? '',
      prefix: json['prefix'] as String? ?? '',
      label: json['label'] as String? ?? '',
      createdAt: json['created_at'] as String? ?? '',
    );
  }
}

/// Collection summary.
class CollectionSummary {
  final String id;
  final String userId;
  final String name;
  final String? description;
  final bool isPublic;
  final String createdAt;
  final String updatedAt;

  const CollectionSummary({
    required this.id,
    required this.userId,
    required this.name,
    this.description,
    required this.isPublic,
    required this.createdAt,
    required this.updatedAt,
  });

  factory CollectionSummary.fromJson(Map<String, dynamic> json) {
    return CollectionSummary(
      id: json['id']?.toString() ?? '',
      userId: json['user_id']?.toString() ?? '',
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      isPublic: json['is_public'] as bool? ?? false,
      createdAt: json['created_at'] as String? ?? '',
      updatedAt: json['updated_at'] as String? ?? '',
    );
  }
}

/// Collection detail with books.
class CollectionDetail {
  final CollectionSummary summary;
  final List<CollectionBookEntry> books;

  const CollectionDetail({required this.summary, required this.books});

  factory CollectionDetail.fromJson(Map<String, dynamic> json) {
    return CollectionDetail(
      summary: CollectionSummary.fromJson(json),
      books: (json['books'] as List? ?? [])
          .map((bookEntryJson) =>
              CollectionBookEntry.fromJson(bookEntryJson as Map<String, dynamic>))
          .toList(),
    );
  }
}

class CollectionBookEntry {
  final String bookId;
  final int position;
  final String addedAt;

  const CollectionBookEntry({
    required this.bookId,
    required this.position,
    required this.addedAt,
  });

  factory CollectionBookEntry.fromJson(Map<String, dynamic> json) {
    return CollectionBookEntry(
      bookId: json['book_id']?.toString() ?? '',
      position: (json['position'] as num?)?.toInt() ?? 0,
      addedAt: json['added_at'] as String? ?? '',
    );
  }
}

/// Reading progress entry.
class ReadingProgress {
  final String bookId;
  final String format;
  final String? locator;
  final double percent;
  final String updatedAt;

  const ReadingProgress({
    required this.bookId,
    required this.format,
    this.locator,
    required this.percent,
    required this.updatedAt,
  });

  factory ReadingProgress.fromJson(Map<String, dynamic> json) {
    return ReadingProgress(
      bookId: json['book_id']?.toString() ?? '',
      format: json['format'] as String? ?? '',
      locator: json['locator'] as String?,
      percent: (json['percent'] as num?)?.toDouble() ?? 0.0,
      updatedAt: json['updated_at'] as String? ?? '',
    );
  }
}

/// The user's reading-state snapshot from GET /me/reading-states.
/// [inProgress] maps book id -> furthest-read fraction (0..1); [completed] is
/// the set of finished book ids.
class ReadingStates {
  final Map<String, double> inProgress;
  final Set<String> completed;

  const ReadingStates({required this.inProgress, required this.completed});

  factory ReadingStates.fromJson(Map<String, dynamic> json) {
    final progressList = (json['in_progress'] as List?) ?? const [];
    final completedList = (json['completed'] as List?) ?? const [];
    return ReadingStates(
      inProgress: {
        for (final entry in progressList)
          (entry as Map<String, dynamic>)['book_id'].toString():
              (entry['percent'] as num?)?.toDouble() ?? 0.0,
      },
      completed: {for (final id in completedList) id.toString()},
    );
  }

  /// reading | finished | unread for a book id.
  String statusFor(String bookId) {
    if (completed.contains(bookId)) return 'finished';
    if (inProgress.containsKey(bookId)) return 'reading';
    return 'unread';
  }
}

/// Bookmark entry.
class BookmarkEntry {
  final String id;
  final String bookId;
  final String locator;
  final String? note;
  final String createdAt;

  const BookmarkEntry({
    required this.id,
    required this.bookId,
    required this.locator,
    this.note,
    required this.createdAt,
  });

  factory BookmarkEntry.fromJson(Map<String, dynamic> json) {
    return BookmarkEntry(
      id: json['id']?.toString() ?? '',
      bookId: json['book_id']?.toString() ?? '',
      locator: json['locator'] as String? ?? '',
      note: json['note'] as String?,
      createdAt: json['created_at'] as String? ?? '',
    );
  }
}

/// Continue reading entry.
class ContinueReadingEntry {
  final Book book;
  final ProgressSummary progress;

  const ContinueReadingEntry({required this.book, required this.progress});

  factory ContinueReadingEntry.fromJson(Map<String, dynamic> json) {
    return ContinueReadingEntry(
      book: Book.fromJson(json['book'] as Map<String, dynamic>),
      progress:
          ProgressSummary.fromJson(json['progress'] as Map<String, dynamic>),
    );
  }
}

class ProgressSummary {
  final String format;
  final double percent;
  final String updatedAt;

  const ProgressSummary({
    required this.format,
    required this.percent,
    required this.updatedAt,
  });

  factory ProgressSummary.fromJson(Map<String, dynamic> json) {
    return ProgressSummary(
      format: json['format'] as String? ?? '',
      percent: (json['percent'] as num?)?.toDouble() ?? 0.0,
      updatedAt: json['updated_at'] as String? ?? '',
    );
  }
}

/// Genre entry.
class GenreEntry {
  final String name;
  final int bookCount;

  const GenreEntry({required this.name, required this.bookCount});

  factory GenreEntry.fromJson(Map<String, dynamic> json) {
    return GenreEntry(
      name: json['name'] as String? ?? '',
      bookCount: (json['book_count'] as num?)?.toInt() ?? 0,
    );
  }
}

/// Author detail with series and standalone count.
class AuthorDetail {
  final Author author;
  final List<Series> series;
  final int standaloneCount;

  const AuthorDetail({
    required this.author,
    required this.series,
    required this.standaloneCount,
  });

  factory AuthorDetail.fromJson(Map<String, dynamic> json) {
    return AuthorDetail(
      author: Author.fromJson(json),
      series: (json['series'] as List? ?? [])
          .map((seriesJson) =>
              Series.fromJson(seriesJson as Map<String, dynamic>))
          .toList(),
      standaloneCount: (json['standalone_count'] as num?)?.toInt() ?? 0,
    );
  }
}

/// Series detail with books.
class SeriesDetail {
  final Series series;
  final List<Book> books;

  const SeriesDetail({required this.series, required this.books});

  factory SeriesDetail.fromJson(Map<String, dynamic> json) {
    return SeriesDetail(
      series: Series.fromJson(json),
      books: (json['books'] as List? ?? [])
          .map((bookJson) => Book.fromJson(bookJson as Map<String, dynamic>))
          .toList(),
    );
  }
}

/// Highlight entry.
class HighlightEntry {
  final String id;
  final String userId;
  final String bookId;
  final String format;
  final String cfiRange;
  final String? textContent;
  final String color;
  final String? note;
  final String createdAt;
  final String updatedAt;

  const HighlightEntry({
    required this.id,
    required this.userId,
    required this.bookId,
    required this.format,
    required this.cfiRange,
    this.textContent,
    required this.color,
    this.note,
    required this.createdAt,
    required this.updatedAt,
  });

  factory HighlightEntry.fromJson(Map<String, dynamic> json) {
    return HighlightEntry(
      id: json['id']?.toString() ?? '',
      userId: json['user_id']?.toString() ?? '',
      bookId: json['book_id']?.toString() ?? '',
      format: json['format'] as String? ?? '',
      cfiRange: json['cfi_range'] as String? ?? '',
      textContent: json['text_content'] as String?,
      color: json['color'] as String? ?? 'yellow',
      note: json['note'] as String?,
      createdAt: json['created_at'] as String? ?? '',
      updatedAt: json['updated_at'] as String? ?? '',
    );
  }
}

/// Custom exception for API errors.
class ApiException implements Exception {
  final String message;
  final int? statusCode;
  final String? errorCode;

  const ApiException(this.message, {this.statusCode, this.errorCode});

  bool get isUnauthorized => statusCode == 401;
  bool get isForbidden => statusCode == 403;
  bool get isNotFound => statusCode == 404;
  bool get isConflict => statusCode == 409;
  bool get isNetworkError => statusCode == null;

  @override
  String toString() => 'ApiException($statusCode): $message';
}

/// Callback invoked when the server returns 401 (session expired).
typedef OnUnauthorizedCallback = void Function();

/// Dio-based API client for the Ironshelf server.
class ApiService {
  late Dio _dio;
  ServerConfig? _serverConfig;
  OnUnauthorizedCallback? _onUnauthorized;

  ApiService() {
    _dio = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
      sendTimeout: const Duration(seconds: 15),
    ));
  }

  /// Configure the API client with a server config.
  void configure(ServerConfig config, {OnUnauthorizedCallback? onUnauthorized}) {
    _serverConfig = config;
    _onUnauthorized = onUnauthorized;

    _dio = Dio(BaseOptions(
      baseUrl: '${config.serverUrl}/api/v1',
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
      sendTimeout: const Duration(seconds: 15),
    ));

    _dio.interceptors.clear();

    // Auth interceptor
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        // The app always talks to the server cross-origin (over its cloud
        // tunnel URL), where cookies don't apply — so send the session id as a
        // Bearer token too. The server accepts any non-`irs_` Bearer as a
        // session id (and `irs_` Bearers as API keys).
        final bearer = config.apiKey ?? config.sessionId;
        if (bearer != null) {
          options.headers['Authorization'] = 'Bearer $bearer';
        }

        // Add custom headers (CF-Access tokens, etc.)
        config.customHeaders.forEach((key, value) {
          options.headers[key] = value;
        });

        return handler.next(options);
      },
      onError: (error, handler) {
        if (error.response?.statusCode == 401) {
          _onUnauthorized?.call();
        }
        return handler.next(error);
      },
    ));

    if (kDebugMode) {
      _dio.interceptors.add(LogInterceptor(
        requestBody: false,
        responseBody: false,
        logPrint: (message) => debugPrint('[API] $message'),
      ));
    }
  }

  /// Update just the auth credentials (after login).
  void updateAuth({String? sessionId, String? apiKey}) {
    if (_serverConfig == null) return;
    _serverConfig = _serverConfig!.copyWith(
      sessionId: sessionId,
      apiKey: apiKey,
    );
    configure(_serverConfig!, onUnauthorized: _onUnauthorized);
  }

  String get baseUrl => _serverConfig?.serverUrl ?? '';

  // ---------------------------------------------------------------------------
  // Server info
  // ---------------------------------------------------------------------------

  /// GET /server/info — public, no auth needed.
  Future<ServerInfo> getServerInfo(String serverUrl) async {
    final response = await Dio(BaseOptions(
      baseUrl: '$serverUrl/api/v1',
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
    )).get('/server/info');
    return ServerInfo.fromJson(response.data as Map<String, dynamic>);
  }

  /// Test connection to a server URL (with optional custom headers).
  Future<ServerInfo> testConnection(
    String serverUrl, {
    Map<String, String>? customHeaders,
  }) async {
    final dio = Dio(BaseOptions(
      baseUrl: '$serverUrl/api/v1',
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
      headers: customHeaders,
    ));
    final response = await dio.get('/server/info');
    return ServerInfo.fromJson(response.data as Map<String, dynamic>);
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  Future<AuthResponse> login(String username, String password) async {
    final response = await _request(
      () => _dio.post('/auth/login', data: {
        'username': username,
        'password': password,
      }),
    );
    return AuthResponse.fromJson(response as Map<String, dynamic>);
  }

  Future<AuthResponse> register(
    String username,
    String password, {
    String? inviteCode,
  }) async {
    final response = await _request(
      () => _dio.post('/auth/register', data: {
        'username': username,
        'password': password,
        if (inviteCode != null) 'invite_code': inviteCode,
      }),
    );
    return AuthResponse.fromJson(response as Map<String, dynamic>);
  }

  Future<void> logout() async {
    await _request(() => _dio.post('/auth/logout'));
  }

  Future<UserInfo> getCurrentUser() async {
    final response = await _request(() => _dio.get('/auth/me'));
    return UserInfo.fromJson(response as Map<String, dynamic>);
  }

  Future<List<ApiKeySummary>> listApiKeys() async {
    final response = await _request(() => _dio.get('/auth/api-keys'));
    return (response as List)
        .map((keyJson) => ApiKeySummary.fromJson(keyJson as Map<String, dynamic>))
        .toList();
  }

  Future<Map<String, dynamic>> createApiKey(String label) async {
    final response = await _request(
      () => _dio.post('/auth/api-keys', data: {'label': label}),
    );
    return response as Map<String, dynamic>;
  }

  Future<void> deleteApiKey(String keyId) async {
    await _request(() => _dio.delete('/auth/api-keys/$keyId'));
  }

  // ---------------------------------------------------------------------------
  // Libraries
  // ---------------------------------------------------------------------------

  Future<List<Library>> getLibraries() async {
    final response = await _request(() => _dio.get('/libraries'));
    return (response as List)
        .map((libraryJson) => Library.fromJson(libraryJson as Map<String, dynamic>))
        .toList();
  }

  Future<Map<String, dynamic>> getLibraryDetail(String libraryId) async {
    final response = await _request(() => _dio.get('/libraries/$libraryId'));
    return response as Map<String, dynamic>;
  }

  Future<void> scanLibrary(String libraryId) async {
    await _request(() => _dio.post('/libraries/$libraryId/scan'));
  }

  // ---------------------------------------------------------------------------
  // Authors
  // ---------------------------------------------------------------------------

  Future<PaginatedResponse<Author>> getAuthors(
    String libraryId, {
    int page = 1,
    int perPage = 50,
    String? sort,
    String? direction,
  }) async {
    final response = await _request(
      () => _dio.get('/libraries/$libraryId/authors', queryParameters: {
        'page': page,
        'per_page': perPage,
        if (sort != null) 'sort': sort,
        if (direction != null) 'dir': direction,
      }),
    );
    return PaginatedResponse.fromJson(
      response as Map<String, dynamic>,
      Author.fromJson,
    );
  }

  Future<AuthorDetail> getAuthorDetail(int authorId) async {
    final response = await _request(() => _dio.get('/authors/$authorId'));
    return AuthorDetail.fromJson(response as Map<String, dynamic>);
  }

  Future<List<Series>> getAuthorSeries(int authorId) async {
    final response =
        await _request(() => _dio.get('/authors/$authorId/series'));
    return (response as List)
        .map((seriesJson) => Series.fromJson(seriesJson as Map<String, dynamic>))
        .toList();
  }

  Future<List<Book>> getAuthorStandaloneBooks(int authorId) async {
    final response =
        await _request(() => _dio.get('/authors/$authorId/standalone'));
    return (response as List)
        .map((bookJson) => Book.fromJson(bookJson as Map<String, dynamic>))
        .toList();
  }

  // ---------------------------------------------------------------------------
  // Series
  // ---------------------------------------------------------------------------

  Future<SeriesDetail> getSeriesDetail(int seriesId) async {
    final response = await _request(() => _dio.get('/series/$seriesId'));
    return SeriesDetail.fromJson(response as Map<String, dynamic>);
  }

  // ---------------------------------------------------------------------------
  // Books
  // ---------------------------------------------------------------------------

  Future<Book> getBook(int bookId) async {
    final response = await _request(() => _dio.get('/books/$bookId'));
    return Book.fromJson(response as Map<String, dynamic>);
  }

  Future<PaginatedResponse<Book>> getLibraryBooks(
    String libraryId, {
    int page = 1,
    int perPage = 30,
    String? sort,
    String? direction,
    String? query,
    String? tag,
    String? language,
  }) async {
    final response = await _request(
      () => _dio.get('/libraries/$libraryId/books', queryParameters: {
        'page': page,
        'per_page': perPage,
        if (sort != null) 'sort': sort,
        if (direction != null) 'dir': direction,
        if (query != null) 'q': query,
        if (tag != null) 'tag': tag,
        if (language != null) 'language': language,
      }),
    );
    return PaginatedResponse.fromJson(
      response as Map<String, dynamic>,
      Book.fromJson,
    );
  }

  /// Cover image URL for a book.
  String coverUrl(int bookId) {
    return '${_serverConfig?.serverUrl ?? ""}/api/v1/books/$bookId/cover';
  }

  /// File download URL for a book.
  String fileUrl(int bookId, {String? format}) {
    final base = '${_serverConfig?.serverUrl ?? ""}/api/v1/books/$bookId/file';
    if (format != null) return '$base?format=$format';
    return base;
  }

  /// Auth headers for CachedNetworkImage.
  Map<String, String> get authHeaders {
    final headers = <String, String>{};
    final bearer = _serverConfig?.apiKey ?? _serverConfig?.sessionId;
    if (bearer != null) {
      headers['Authorization'] = 'Bearer $bearer';
    }
    _serverConfig?.customHeaders.forEach((key, value) {
      headers[key] = value;
    });
    return headers;
  }

  /// Exchange a cloud-issued server access token for a local server session.
  /// POST {serverUrl}/api/v1/auth/cloud-login -> { session_id, ... }.
  /// Returns the session id the app then uses as its Bearer token.
  Future<String> cloudLoginToServer(
    String serverUrl,
    String serverAccessToken,
  ) async {
    final dio = Dio(BaseOptions(
      baseUrl: '$serverUrl/api/v1',
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 20),
    ));
    final response = await dio.post(
      '/auth/cloud-login',
      data: {'cloud_token': serverAccessToken},
    );
    final data = response.data as Map<String, dynamic>;
    final sessionId = data['session_id'] as String?;
    if (sessionId == null || sessionId.isEmpty) {
      throw const ApiException('Server did not return a session');
    }
    return sessionId;
  }

  // ---------------------------------------------------------------------------
  // Book file download (for the readers)
  // ---------------------------------------------------------------------------

  /// Download a book's file for a given format to a local cache file and return
  /// it. Auth + CF-Access headers are applied by the dio interceptor. If a
  /// non-empty cached copy already exists it is reused (offline-friendly).
  ///
  /// [onProgress] receives (received, total) byte counts; total is -1 until the
  /// server sends Content-Length.
  Future<File> downloadBookFile(
    int bookId,
    String format, {
    void Function(int received, int total)? onProgress,
  }) async {
    final cacheDir = await getTemporaryDirectory();
    final safeFormat = format.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');
    final file = File('${cacheDir.path}/book_${bookId}_$safeFormat.$safeFormat');

    if (await file.exists() && await file.length() > 0) {
      onProgress?.call(await file.length(), await file.length());
      return file;
    }

    await _dio.download(
      '/books/$bookId/file',
      file.path,
      queryParameters: {'format': format},
      onReceiveProgress: onProgress,
    );
    return file;
  }

  // ---------------------------------------------------------------------------
  // Reading status (read / unread)
  // ---------------------------------------------------------------------------

  /// Mark a book as read for the current user.
  Future<void> markBookRead(String bookId) async {
    await _request(() => _dio.post('/books/$bookId/complete'));
  }

  /// Mark a book unread — also clears saved progress so it reopens from start.
  Future<void> markBookUnread(String bookId) async {
    await _request(() => _dio.delete('/books/$bookId/complete'));
  }

  /// The user's reading-state snapshot: in-progress percents + finished IDs.
  Future<ReadingStates> getReadingStates() async {
    final response = await _request(() => _dio.get('/me/reading-states'));
    return ReadingStates.fromJson(response as Map<String, dynamic>);
  }

  // ---------------------------------------------------------------------------
  // Continue reading
  // ---------------------------------------------------------------------------

  Future<List<ContinueReadingEntry>> getContinueReading() async {
    final response = await _request(() => _dio.get('/books/continue'));
    return (response as List)
        .map((entryJson) =>
            ContinueReadingEntry.fromJson(entryJson as Map<String, dynamic>))
        .toList();
  }

  // ---------------------------------------------------------------------------
  // Reading progress
  // ---------------------------------------------------------------------------

  Future<List<ReadingProgress>> getProgress(String bookId) async {
    final response =
        await _request(() => _dio.get('/books/$bookId/progress'));
    return (response as List)
        .map((progressJson) =>
            ReadingProgress.fromJson(progressJson as Map<String, dynamic>))
        .toList();
  }

  Future<void> updateProgress(
    String bookId, {
    required String format,
    required double percent,
    String? locator,
  }) async {
    await _request(
      () => _dio.put('/books/$bookId/progress', data: {
        'format': format,
        'percent': percent,
        if (locator != null) 'locator': locator,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Bookmarks
  // ---------------------------------------------------------------------------

  Future<List<BookmarkEntry>> getBookmarks(String bookId) async {
    final response =
        await _request(() => _dio.get('/books/$bookId/bookmarks'));
    return (response as List)
        .map((bookmarkJson) =>
            BookmarkEntry.fromJson(bookmarkJson as Map<String, dynamic>))
        .toList();
  }

  Future<BookmarkEntry> createBookmark(
    String bookId, {
    required String locator,
    String? note,
  }) async {
    final response = await _request(
      () => _dio.post('/books/$bookId/bookmarks', data: {
        'locator': locator,
        if (note != null) 'note': note,
      }),
    );
    return BookmarkEntry.fromJson(response as Map<String, dynamic>);
  }

  Future<void> deleteBookmark(String bookId, String bookmarkId) async {
    await _request(
        () => _dio.delete('/books/$bookId/bookmarks/$bookmarkId'));
  }

  // ---------------------------------------------------------------------------
  // Highlights
  // ---------------------------------------------------------------------------

  Future<List<HighlightEntry>> getBookHighlights(String bookId) async {
    final response =
        await _request(() => _dio.get('/books/$bookId/highlights'));
    return (response as List)
        .map((highlightJson) =>
            HighlightEntry.fromJson(highlightJson as Map<String, dynamic>))
        .toList();
  }

  Future<String> createHighlight(
    String bookId, {
    required String cfiRange,
    String? textContent,
    String color = 'yellow',
    String? note,
    String format = 'EPUB',
  }) async {
    final response = await _request(
      () => _dio.post('/books/$bookId/highlights', data: {
        'cfi_range': cfiRange,
        if (textContent != null) 'text_content': textContent,
        'color': color,
        if (note != null) 'note': note,
        'format': format,
      }),
    );
    return (response as Map<String, dynamic>)['id'] as String;
  }

  Future<void> deleteHighlight(String highlightId) async {
    await _request(() => _dio.delete('/highlights/$highlightId'));
  }

  Future<List<HighlightEntry>> getAllHighlights({
    String? bookId,
    String? color,
  }) async {
    final response = await _request(
      () => _dio.get('/me/highlights', queryParameters: {
        if (bookId != null) 'book_id': bookId,
        if (color != null) 'color': color,
      }),
    );
    return (response as List)
        .map((highlightJson) =>
            HighlightEntry.fromJson(highlightJson as Map<String, dynamic>))
        .toList();
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  Future<SearchResults> search(
    String query, {
    String type = 'all',
    int page = 1,
    int perPage = 20,
  }) async {
    final response = await _request(
      () => _dio.get('/search', queryParameters: {
        'q': query,
        'type': type,
        'page': page,
        'per_page': perPage,
      }),
    );
    return SearchResults.fromJson(response as Map<String, dynamic>);
  }

  // ---------------------------------------------------------------------------
  // Collections
  // ---------------------------------------------------------------------------

  Future<List<CollectionSummary>> getCollections() async {
    final response = await _request(() => _dio.get('/collections'));
    return (response as List)
        .map((collectionJson) =>
            CollectionSummary.fromJson(collectionJson as Map<String, dynamic>))
        .toList();
  }

  Future<CollectionDetail> getCollectionDetail(String collectionId) async {
    final response =
        await _request(() => _dio.get('/collections/$collectionId'));
    return CollectionDetail.fromJson(response as Map<String, dynamic>);
  }

  Future<Map<String, dynamic>> createCollection({
    required String name,
    String? description,
    bool isPublic = false,
  }) async {
    final response = await _request(
      () => _dio.post('/collections', data: {
        'name': name,
        if (description != null) 'description': description,
        'is_public': isPublic,
      }),
    );
    return response as Map<String, dynamic>;
  }

  Future<void> updateCollection(
    String collectionId, {
    String? name,
    String? description,
    bool? isPublic,
  }) async {
    await _request(
      () => _dio.patch('/collections/$collectionId', data: {
        if (name != null) 'name': name,
        if (description != null) 'description': description,
        if (isPublic != null) 'is_public': isPublic,
      }),
    );
  }

  Future<void> deleteCollection(String collectionId) async {
    await _request(() => _dio.delete('/collections/$collectionId'));
  }

  Future<void> addBookToCollection(
    String collectionId,
    String bookId, {
    int? position,
  }) async {
    await _request(
      () => _dio.post('/collections/$collectionId/books', data: {
        'book_id': bookId,
        if (position != null) 'position': position,
      }),
    );
  }

  Future<void> removeBookFromCollection(
    String collectionId,
    String bookId,
  ) async {
    await _request(
        () => _dio.delete('/collections/$collectionId/books/$bookId'));
  }

  // ---------------------------------------------------------------------------
  // Genres
  // ---------------------------------------------------------------------------

  Future<List<GenreEntry>> getAllGenres() async {
    final response = await _request(() => _dio.get('/genres'));
    return (response as List)
        .map((genreJson) => GenreEntry.fromJson(genreJson as Map<String, dynamic>))
        .toList();
  }

  Future<List<GenreEntry>> getLibraryGenres(String libraryId) async {
    final response =
        await _request(() => _dio.get('/libraries/$libraryId/genres'));
    return (response as List)
        .map((genreJson) => GenreEntry.fromJson(genreJson as Map<String, dynamic>))
        .toList();
  }

  Future<PaginatedResponse<Book>> getGenreBooks(
    String genreName, {
    int page = 1,
    int perPage = 30,
    String? sort,
    String? direction,
  }) async {
    final encoded = Uri.encodeComponent(genreName);
    final response = await _request(
      () => _dio.get('/genres/$encoded', queryParameters: {
        'page': page,
        'per_page': perPage,
        if (sort != null) 'sort': sort,
        if (direction != null) 'dir': direction,
      }),
    );
    return PaginatedResponse.fromJson(
      response as Map<String, dynamic>,
      Book.fromJson,
    );
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  Future<Map<String, dynamic>> getServerStats() async {
    final response = await _request(() => _dio.get('/stats'));
    return response as Map<String, dynamic>;
  }

  Future<List<Map<String, dynamic>>> getUserActivity({int limit = 50}) async {
    final response = await _request(
      () => _dio.get('/activity', queryParameters: {'limit': limit}),
    );
    return (response as List).cast<Map<String, dynamic>>();
  }

  // ---------------------------------------------------------------------------
  // Request wrapper
  // ---------------------------------------------------------------------------

  Future<dynamic> _request(Future<Response> Function() requestFn) async {
    try {
      final response = await requestFn();
      return response.data;
    } on DioException catch (dioError) {
      if (dioError.type == DioExceptionType.connectionTimeout ||
          dioError.type == DioExceptionType.receiveTimeout ||
          dioError.type == DioExceptionType.sendTimeout) {
        throw const ApiException(
          'Connection timed out. Check your server URL and network.',
        );
      }

      if (dioError.type == DioExceptionType.connectionError) {
        throw const ApiException(
          'Could not connect to server. Check the URL and ensure it is reachable.',
        );
      }

      final statusCode = dioError.response?.statusCode;
      final responseData = dioError.response?.data;

      String message = 'Request failed';
      String? errorCode;

      if (responseData is Map<String, dynamic>) {
        message = responseData['error'] as String? ?? message;
        errorCode = responseData['code'] as String?;
      }

      throw ApiException(
        message,
        statusCode: statusCode,
        errorCode: errorCode,
      );
    }
  }
}
