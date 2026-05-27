/// Book model.
class Book {
  final int id;
  final String title;
  final String sortTitle;
  final List<int> authorIds;
  final int? seriesId;
  final double? seriesIndex;
  final List<BookFormat> formats;
  final bool hasCover;
  final String path;
  final String? pubdate;
  final String? addedAt;
  final int? rating;
  final List<String> tags;
  final List<String> languages;
  final Map<String, String> identifiers;
  final String? description;
  final Map<String, dynamic> custom;

  const Book({
    required this.id,
    required this.title,
    required this.sortTitle,
    required this.authorIds,
    this.seriesId,
    this.seriesIndex,
    required this.formats,
    required this.hasCover,
    required this.path,
    this.pubdate,
    this.addedAt,
    this.rating,
    required this.tags,
    required this.languages,
    required this.identifiers,
    this.description,
    required this.custom,
  });

  factory Book.fromJson(Map<String, dynamic> json) {
    return Book(
      id: (json['id'] as num).toInt(),
      title: json['title'] as String? ?? '',
      sortTitle: json['sort_title'] as String? ?? '',
      authorIds: (json['author_ids'] as List?)
              ?.map((element) => (element as num).toInt())
              .toList() ??
          [],
      seriesId: (json['series_id'] as num?)?.toInt(),
      seriesIndex: (json['series_index'] as num?)?.toDouble(),
      formats: (json['formats'] as List?)
              ?.map((f) => BookFormat.fromJson(f as Map<String, dynamic>))
              .toList() ??
          [],
      hasCover: json['has_cover'] as bool? ?? false,
      path: json['path'] as String? ?? '',
      pubdate: json['pubdate'] as String?,
      addedAt: json['added_at'] as String?,
      rating: (json['rating'] as num?)?.toInt(),
      tags: (json['tags'] as List?)
              ?.map((element) => element.toString())
              .toList() ??
          [],
      languages: (json['languages'] as List?)
              ?.map((element) => element.toString())
              .toList() ??
          [],
      identifiers: Map<String, String>.from(json['identifiers'] as Map? ?? {}),
      description: json['description'] as String?,
      custom: Map<String, dynamic>.from(json['custom'] as Map? ?? {}),
    );
  }
}

/// Book format (EPUB, PDF, etc).
class BookFormat {
  final String kind;
  final String fileName;
  final int? size;

  const BookFormat({
    required this.kind,
    required this.fileName,
    this.size,
  });

  factory BookFormat.fromJson(Map<String, dynamic> json) {
    return BookFormat(
      kind: json['kind'] as String? ?? '',
      fileName: json['file_name'] as String? ?? '',
      size: (json['size'] as num?)?.toInt(),
    );
  }
}
