import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/book.dart';
import 'server_provider.dart';

/// Single book detail by ID.
final bookDetailProvider =
    FutureProvider.family.autoDispose<Book, int>((ref, bookId) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.getBook(bookId);
});

/// Cover URL provider.
final coverUrlProvider = Provider.family<String, int>((ref, bookId) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.coverUrl(bookId);
});

/// File URL provider.
final fileUrlProvider =
    Provider.family<String, ({int bookId, String? format})>((ref, params) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.fileUrl(params.bookId, format: params.format);
});

/// Auth headers for cached images.
final authHeadersProvider = Provider<Map<String, String>>((ref) {
  final apiService = ref.read(apiServiceProvider);
  return apiService.authHeaders;
});
