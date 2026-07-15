/**
 *   (c) 2001-2016 Nathan Hjelm <hjelmn@users.sourceforge.net>
 *   v1.5.0 util.c
 *   
 *   Utility functions that are missing on some platforms.
 *
 *   This program is free software; you can redistribute it and/or modify
 *   it under the terms of the GNU Lesser General Public License as published
 *   by the Free Software Foundation; either version 2 of the License, or
 *   (at your option) any later version.
 *   
 *   This program is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU Lesser General Public License for more details.
 *   
 *   You should have received a copy of the GNU General Public License
 *   along with this program; if not, write to the Free Software
 *   Foundation, Inc., 675 Mass Ave, Cambridge, MA 02139, USA.
 **/

#include <string.h>
#include <sys/types.h>

#include "rioi.h"

#if !defined(HAVE_BASENAME)
char *basename(char *x){
  char *slash;
  char *backslash;

  if (x == NULL || x[0] == '\0')
    return x;

  slash = strrchr (x, '/');
  backslash = strrchr (x, '\\');

  if (backslash != NULL && (slash == NULL || backslash > slash))
    slash = backslash;

  return (slash == NULL) ? x : slash + 1;
}
#endif

void rio_pack_rio800_title_bitmap (
  rio_file_t *file,
  const u_int8_t pixels[RIO800_TITLE_BITMAP_HEIGHT][RIO800_TITLE_BITMAP_WIDTH]
) {
  u_int8_t *bitmap;
  u_int16_t column;
  int x, y;

  if (file == NULL || pixels == NULL)
    return;

  bitmap = (u_int8_t *)file + RIO800_TITLE_BITMAP_OFFSET;

  for (x = 0 ; x < RIO800_TITLE_BITMAP_WIDTH ; x++) {
    column = 0x2000;
    for (y = 0 ; y < RIO800_TITLE_BITMAP_HEIGHT ; y++)
      if (pixels[y][x])
        column |= (u_int16_t)(1u << (RIO800_TITLE_BITMAP_HEIGHT - 1 - y));

    bitmap[x * 2] = (u_int8_t)(column & 0xff);
    bitmap[x * 2 + 1] = (u_int8_t)(column >> 8);
  }
}

static u_int16_t rio800_title_stride (
  const u_int8_t pixels[RIO800_TITLE_BITMAP_HEIGHT][RIO800_TITLE_BITMAP_WIDTH]
) {
  int x, y;

  for (x = RIO800_TITLE_BITMAP_WIDTH - 1 ; x >= 0 ; x--)
    for (y = 0 ; y < RIO800_TITLE_BITMAP_HEIGHT ; y++)
      if (pixels[y][x])
        return (u_int16_t)((x + 8) / 8);

  return 0;
}

void rio_prepare_rio800_header (rio_file_t *file) {
  u_int8_t pixels[RIO800_TITLE_BITMAP_HEIGHT][RIO800_TITLE_BITMAP_WIDTH];
  u_int8_t *raw;
  const u_int8_t *cursor;
  u_int16_t stride;
  int has_non_ascii = 0;

  if (file == NULL)
    return;

  if (file->type != TYPE_MP3 && file->type != TYPE_WMA &&
      file->type != TYPE_WAV && file->type != TYPE_WAVE)
    return;

  memset (file->artist, 0, sizeof (file->artist));
  memset (file->album, 0, sizeof (file->album));

  file->bits |= 0x00400000;

  for (cursor = (const u_int8_t *)file->title ; *cursor != '\0' ; cursor++)
    if (*cursor >= 0x80) {
      has_non_ascii = 1;
      break;
    }

  if (!has_non_ascii)
    return;

  memset (pixels, 0, sizeof (pixels));
  if (rio_render_rio800_title_bitmap (file->title, pixels) == 0) {
    stride = rio800_title_stride (pixels);
    if (stride == 0)
      return;

    rio_pack_rio800_title_bitmap (file, pixels);
    raw = (u_int8_t *)file;
    raw[RIO800_TITLE_STRIDE_OFFSET] = (u_int8_t)(stride & 0xff);
    raw[RIO800_TITLE_STRIDE_OFFSET + 1] = (u_int8_t)(stride >> 8);
    raw[RIO800_TITLE_ROWS_OFFSET] = 0x0c;
    raw[RIO800_TITLE_ROWS_OFFSET + 1] = 0;
    raw[RIO800_TITLE_ROWS_OFFSET + 2] = 0;
    raw[RIO800_TITLE_FORMAT_OFFSET] = 1;
  }
}
