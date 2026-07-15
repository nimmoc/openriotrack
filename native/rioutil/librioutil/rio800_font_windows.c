#include <windows.h>

#include <string.h>

#include "rioi.h"

int rio_render_rio800_title_bitmap (
  const char *title,
  u_int8_t pixels[RIO800_TITLE_BITMAP_HEIGHT][RIO800_TITLE_BITMAP_WIDTH]
) {
  BITMAPINFO bitmap_info;
  HBITMAP bitmap = NULL;
  HDC dc = NULL;
  HFONT font = NULL;
  HGDIOBJ old_bitmap = NULL;
  HGDIOBJ old_font = NULL;
  RECT bounds = {0, 0, RIO800_TITLE_BITMAP_WIDTH, RIO800_TITLE_BITMAP_HEIGHT};
  RGBQUAD *bitmap_pixels = NULL;
  wchar_t wide_title[64];
  int length, x, y;
  int result = -1;

  if (title == NULL || title[0] == '\0' || pixels == NULL)
    return -1;

  length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, title, -1,
                               wide_title, sizeof (wide_title) / sizeof (wide_title[0]));
  if (length <= 1)
    return -1;

  memset (&bitmap_info, 0, sizeof (bitmap_info));
  bitmap_info.bmiHeader.biSize = sizeof (BITMAPINFOHEADER);
  bitmap_info.bmiHeader.biWidth = RIO800_TITLE_BITMAP_WIDTH;
  bitmap_info.bmiHeader.biHeight = -RIO800_TITLE_BITMAP_HEIGHT;
  bitmap_info.bmiHeader.biPlanes = 1;
  bitmap_info.bmiHeader.biBitCount = 32;
  bitmap_info.bmiHeader.biCompression = BI_RGB;

  dc = CreateCompatibleDC(NULL);
  if (dc == NULL)
    goto cleanup;

  bitmap = CreateDIBSection(dc, &bitmap_info, DIB_RGB_COLORS,
                            (void **)&bitmap_pixels, NULL, 0);
  if (bitmap == NULL || bitmap_pixels == NULL)
    goto cleanup;

  old_bitmap = SelectObject(dc, bitmap);
  FillRect(dc, &bounds, (HBRUSH)GetStockObject(WHITE_BRUSH));
  SetBkMode(dc, TRANSPARENT);
  SetTextColor(dc, RGB(0, 0, 0));

  font = CreateFontW(-13, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
                     GB2312_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                     NONANTIALIASED_QUALITY, FIXED_PITCH | FF_DONTCARE, L"SimSun");
  if (font == NULL)
    goto cleanup;

  old_font = SelectObject(dc, font);
  TextOutW(dc, 0, -2, wide_title, length - 1);
  GdiFlush();

  for (y = 0 ; y < RIO800_TITLE_BITMAP_HEIGHT ; y++)
    for (x = 0 ; x < RIO800_TITLE_BITMAP_WIDTH ; x++) {
      RGBQUAD pixel = bitmap_pixels[y * RIO800_TITLE_BITMAP_WIDTH + x];
      pixels[y][x] = pixel.rgbRed < 128 || pixel.rgbGreen < 128 || pixel.rgbBlue < 128;
    }

  result = 0;

cleanup:
  if (old_font != NULL)
    SelectObject(dc, old_font);
  if (font != NULL)
    DeleteObject(font);
  if (old_bitmap != NULL)
    SelectObject(dc, old_bitmap);
  if (bitmap != NULL)
    DeleteObject(bitmap);
  if (dc != NULL)
    DeleteDC(dc);

  return result;
}
