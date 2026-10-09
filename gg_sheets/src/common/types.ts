/** Dòng dữ liệu trong Sheet; rowNumber tính từ 1, bao gồm dòng tiêu đề. */
export interface SheetRow {
  rowNumber: number;
  values: Record<string, string>;
}
