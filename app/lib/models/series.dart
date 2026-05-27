/// Series model.
class Series {
  final int id;
  final String name;
  final String sortName;
  final int bookCount;

  const Series({
    required this.id,
    required this.name,
    required this.sortName,
    required this.bookCount,
  });

  factory Series.fromJson(Map<String, dynamic> json) {
    return Series(
      id: (json['id'] as num).toInt(),
      name: json['name'] as String? ?? '',
      sortName: json['sort_name'] as String? ?? '',
      bookCount: (json['book_count'] as num?)?.toInt() ?? 0,
    );
  }
}
