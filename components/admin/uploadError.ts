/** Plain message for a failed storage upload (409 name taken, 415 wrong type, 413 too large). */
export function uploadErrorText(err: any): string {
  const status = String(err?.statusCode ?? err?.status ?? '');
  const msg = String(err?.message || '');
  if (status === '415' || /unsupported|not allowed|mime|type/i.test(msg)) return 'Only images (JPG, PNG, WebP, GIF) and PDFs can be uploaded.';
  if (status === '413' || /too large|size/i.test(msg)) return 'The file is too large (15 MB at most).';
  if (status === '409' || /exists|duplicate/i.test(msg)) return 'A file with that name already exists. Please try the upload again.';
  return msg || 'The upload failed. Please try again.';
}
