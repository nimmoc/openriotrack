/**
 *   (c) 2003-2016 Nathan Hjelm <hjelmn@users.sourceforge.net>
 *   v2.0b id3.c 
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

#include <stdlib.h>
#include <stdio.h>

#include <string.h>
#include <errno.h>

#include <sys/types.h>
#include <sys/stat.h>

#if !defined(_WIN32)
#include <sys/ioctl.h>
#include <sys/uio.h>
#endif

#include <time.h>
#include <unistd.h>
#include <fcntl.h>

#if defined(HAVE_CONFIG_H)
#include "config.h"
#endif

#ifdef HAVE_LIBGEN_H
#include <libgen.h>
#endif

#include "rioi.h"
#include "genre.h"

#define ID3FLAG_EXTENDED 0x40
#define ID3FLAG_FOOTER   0x10

#define MIN(x,y) (((x) > (y)) ? (y) : (x))

                       /* v2.2 v2.3 */
char *ID3_TITLE[2]   = {"TT2", "TIT2"};
char *ID3_ARTIST[2]  = {"TP1", "TPE1"};
char *ID3_ALBUM[2]   = {"TAL", "TALB"};
char *ID3_TRACK[2]   = {"TRK", "TRCK"};
char *ID3_YEAR[2]    = {"TYE", "TYER"};
char *ID3_GENRE[2]   = {"TCO", "TCON"};
char *ID3_ENCODER[2] = {"TEN", "TENC"}; 
char *ID3_COMMENT[2] = {"COM", "COMM"};
char *ID3_BPM[2]     = {"TBP", "TBPM"};
char *ID3_YEARNEW[2] = {"TYE", "TDRC"};
char *ID3_DISC[2]    = {"TPA", "TPOS"};
char *ID3_ARTWORK[2] = {"PIC", "APIC"};

static int find_id3 (int version, FILE *fh, unsigned char *tag_data, int *tag_datalen,
		     int *id3_len, int *major_version);
static int one_pass_parse_id3v2 (FILE *fh, unsigned char *tag_data, int tag_datalen, int id3v2_majorversion,
				  rio_file_t *mp3_file);
static int synchsafe_to_int (unsigned char *buf, int nbytes);

static int synchsafe_to_int (unsigned char *buf, int nbytes) {
  int i, id3v2_len;
  int error = 0;

  for (i = 0, id3v2_len = 0 ; i < nbytes ; i++) {
    id3v2_len = (id3v2_len << 7) | (buf[i] & 0x7f);

    /* the high bit of any can not be set in a syncsafe integer */
    if (buf[i] & 0x80)
      error = 1;
  }

  if (error)
    /* fall back to a 32-bit BE int */
    for (i = 0, id3v2_len = 0 ; i < nbytes ; i++)
      id3v2_len = (id3v2_len << 8) | (buf[i] & 0xff);

  return id3v2_len;
}

int id3v2_size (unsigned char data[14]) {
  int major_version;
  unsigned char id3v2_flags;
  int id3v2_len = 0;
  int head;

  memcpy (&head, data, 4);
  head = big32_2_arch32 (head);

  if ((head & 0xffffff00) == 0x49443300) {
    major_version = head & 0xff;
    
    id3v2_flags = data[5];
    id3v2_len   = 10 + synchsafe_to_int (&data[6], 4);

    if (id3v2_flags & ID3FLAG_EXTENDED) {
      /* Skip extended header */
      if (major_version != 3)
	id3v2_len += synchsafe_to_int (&data[10], 4);
      else
	id3v2_len += big32_2_arch32 (((int *)&data[10])[0]);
    }
    
    /* total length = 10 (header) + extended header length (flag 0x40) + id3v2len + 10 (footer, if present -- flag 0x10) */
    id3v2_len += (id3v2_flags & ID3FLAG_FOOTER) ? 10 : 0;
  }

  return id3v2_len;
}

/*
  find_id3 takes in a file descriptor, a pointer to where the tag data is to be put,
  and a pointer to where the data length is to be put.

  find_id3 returns:
    0 for no id3 tags
    1 for id3v1 tag
    2 for id3v2 tag

  The file descriptor is reset to the start of the file on completion.
*/
static int find_id3 (int version, FILE *fh, unsigned char *tag_data, int *tag_datalen,
		     int *id3_len, int *major_version) {
    int head;
    unsigned char data[10];

    char id3v2_flags;
    int  id3v2_len;
    int  id3v2_extendedlen;

    if (version == 2) {
      fread(&head, 4, 1, fh);
      head = big32_2_arch32(head);

      /* version 2 */
      if ((head & 0xffffff00) == 0x49443300) {
	fread(data, 1, 10, fh);
	
	*major_version = head & 0xff;
	
	id3v2_flags = data[1];
	
	id3v2_len = *id3_len = synchsafe_to_int (&data[2], 4);

	*id3_len += 10; /* total length = id3v2len + 010 + footer (if present) */
	*id3_len += (id3v2_flags & 0x10) ? 10 : 0; /* ID3v2 footer */

	/* the 6th bit of the flag field being set indicates that an
	   extended header is present */
	if (id3v2_flags & 0x40) {
	  /* Skip extended header */
	  id3v2_extendedlen = synchsafe_to_int (&data[6], 4);
	  
	  fseek(fh, 0xa + id3v2_extendedlen, SEEK_SET);
	  *tag_datalen = id3v2_len - id3v2_extendedlen;
	} else {
	  /* Skip standard header */
	  fseek(fh, 0xa, SEEK_SET);
	  *tag_datalen = id3v2_len;
	}
	
	return 2;
      }
    } else if (version == 1) {
      fseek(fh, -128, SEEK_END);
      fread(&head, 1, 4, fh);
      fseek(fh, -128, SEEK_END);
	
      head = big32_2_arch32(head);
      
      if ((head & 0xffffff00) == 0x54414700) {
	fread(tag_data, 1, 128, fh);
	
	return 1;
      }
    }
    
    /* no id3 found */
    return 0;
}

static char *id3v1_string (unsigned char *unclean) {
  int i;
  static char buffer[31];

  memset (buffer, 0, 31);

  for (i = 0 ; i < 30 && unclean[i] != 0xff ; i++)
    buffer[i] = unclean[i];

  for (i = strlen (buffer) - 1 ; i >= 0 && buffer[i] == ' ' ; i--)
    buffer[i] = '\0';

  return buffer;
}

static int check_id_id3v2 (FILE *fh, int offset) {
  int i, current_offset;
  char identifier[5];

  current_offset = ftell (fh);

  identifier[4] = '\0';

  fseek (fh, offset, SEEK_SET);
  fread (identifier, 1, 4, fh);
  fseek (fh, current_offset, SEEK_SET);

  for (i = 0 ; i < 4 ; i++)
    if (identifier[i] != ' ' && (identifier[i] < 'A' || identifier[i] > 'Z') &&
	(identifier[i] < '0' || identifier[i] > '9'))
      return -1;

  return 0;
}

static size_t append_utf8 (char *output, size_t capacity, size_t offset, unsigned int codepoint) {
  unsigned char encoded[4];
  size_t count;

  if (codepoint <= 0x7f) {
    encoded[0] = codepoint;
    count = 1;
  } else if (codepoint <= 0x7ff) {
    encoded[0] = 0xc0 | (codepoint >> 6);
    encoded[1] = 0x80 | (codepoint & 0x3f);
    count = 2;
  } else if (codepoint <= 0xffff) {
    encoded[0] = 0xe0 | (codepoint >> 12);
    encoded[1] = 0x80 | ((codepoint >> 6) & 0x3f);
    encoded[2] = 0x80 | (codepoint & 0x3f);
    count = 3;
  } else if (codepoint <= 0x10ffff) {
    encoded[0] = 0xf0 | (codepoint >> 18);
    encoded[1] = 0x80 | ((codepoint >> 12) & 0x3f);
    encoded[2] = 0x80 | ((codepoint >> 6) & 0x3f);
    encoded[3] = 0x80 | (codepoint & 0x3f);
    count = 4;
  } else {
    return offset;
  }

  if (offset + count >= capacity)
    return offset;

  memcpy (output + offset, encoded, count);
  return offset + count;
}

static void decode_id3_text (const unsigned char *input, size_t length,
                             char *output, size_t capacity) {
  size_t input_offset = 1, output_offset = 0;
  int little_endian = 0;
  unsigned char encoding;

  if (!input || length == 0 || !output || capacity == 0)
    return;

  memset (output, 0, capacity);
  encoding = input[0];

  if (encoding == 0x00) {
    while (input_offset < length && input[input_offset] != 0) {
      output_offset = append_utf8 (output, capacity, output_offset, input[input_offset]);
      input_offset++;
    }
  } else if (encoding == 0x03) {
    size_t copy_length = 0;
    while (input_offset + copy_length < length && input[input_offset + copy_length] != 0)
      copy_length++;
    if (copy_length >= capacity)
      copy_length = capacity - 1;
    memcpy (output, input + input_offset, copy_length);
    output_offset = copy_length;
  } else if (encoding == 0x01 || encoding == 0x02) {
    if (encoding == 0x01 && input_offset + 1 < length) {
      if (input[input_offset] == 0xff && input[input_offset + 1] == 0xfe) {
        little_endian = 1;
        input_offset += 2;
      } else if (input[input_offset] == 0xfe && input[input_offset + 1] == 0xff) {
        input_offset += 2;
      }
    }

    while (input_offset + 1 < length) {
      unsigned int codepoint = little_endian
        ? input[input_offset] | (input[input_offset + 1] << 8)
        : (input[input_offset] << 8) | input[input_offset + 1];
      input_offset += 2;

      if (codepoint == 0)
        break;

      if (codepoint >= 0xd800 && codepoint <= 0xdbff && input_offset + 1 < length) {
        unsigned int low = little_endian
          ? input[input_offset] | (input[input_offset + 1] << 8)
          : (input[input_offset] << 8) | input[input_offset + 1];
        if (low >= 0xdc00 && low <= 0xdfff) {
          codepoint = 0x10000 + ((codepoint - 0xd800) << 10) + (low - 0xdc00);
          input_offset += 2;
        }
      }

      output_offset = append_utf8 (output, capacity, output_offset, codepoint);
    }
  }

  output[output_offset] = '\0';
}

/*
  parse_id3
*/
static int one_pass_parse_id3v2 (FILE *fh, unsigned char *tag_data, int tag_datalen, int id3v2_majorversion,
				 rio_file_t *mp3_file) {
  int i;
  char decoded_text[256], identifier[5];
  int newv = (id3v2_majorversion > 2) ? 1 : 0;
  int id3v2_offset, genre_index;

  memset (identifier, 0, 5);
    
  id3v2_offset = ftell (fh);
  
  for (i = 0 ; i < tag_datalen ; ) {
    size_t length = 0;
      
    fseek (fh, id3v2_offset + i, SEEK_SET);
    fread (tag_data, 1, 6 + 4 * newv, fh);

    i += 6 + 4 * newv;

    if (tag_data[0] == 0)
      return -1;
      
    memmove (identifier, tag_data, 3 + newv);
 
    switch (id3v2_majorversion) {
    case 1:
    case 2:
      length = (tag_data[3] << 16) | (tag_data[4] << 8) | tag_data[5];
      break;
    case 3:
      length = big32_2_arch32(((int *)tag_data)[1]);
      break;
    case 4:
    default:
      length = synchsafe_to_int (&tag_data[4], 4);

      if (check_id_id3v2 (fh, i + length) < 0)
	/* tag was probably written by iTunes (not to spec) */
	length = big32_2_arch32(((int *)tag_data)[1]);
    }

    if (length == (size_t) -1) {
      fprintf (stderr, "id3.c/parse_id3v2: tag %s has bad length... Aborting!\n", identifier);

      return -1;
    }

    i += length;
    
    /* read the first 128 bytes of data */
    memset (tag_data, 0, 128);
    fread (tag_data, 1, MIN(length, 128), fh);

    if (length > 128)
      length = 128;

    if (strcmp (identifier, "APIC") == 0 || strcmp (identifier, "PIC") == 0)
      continue;

    decode_id3_text (tag_data, length, decoded_text, sizeof (decoded_text));
    length = strlen (decoded_text);

    if (length == 0)
      /* empty tag*/
      continue;

    if (strcmp (identifier, ID3_TRACK[newv]) == 0) {
      /* some id3 tags have track/total tracks in the TRK field */
      mp3_file->trackno2 = strtol (decoded_text, NULL, 10);
    } else if (strcmp (identifier, ID3_GENRE[newv]) == 0) {
      const char *genre = decoded_text;

      if (genre[0] == '(' || (genre[0] >= '0' && genre[0] <= '9') ) {

	if (genre[0] == '(')
	  genre_index = strtol (&genre[1], NULL, 10);
	else
	  genre_index = strtol (&genre[0], NULL, 10);

	if (genre_index > genre_count)
	  genre_index = genre_count;

	genre = genre_table[genre_index];
	length = strlen (genre);
      }

      strncpy ((char *)mp3_file->genre2, genre, MIN(length, 22));
    } else if (strcmp (identifier, ID3_YEARNEW[newv]) == 0 || strcmp (identifier, ID3_YEAR[newv]) == 0)
      /* the recording year is always the first 4 characters */
      memmove (mp3_file->year2, decoded_text, MIN(length, 4));
    else if (strcmp (identifier, ID3_TITLE[newv]) == 0)
      strncpy ((char *)mp3_file->title, decoded_text, MIN(length, 63));
    else if (strcmp (identifier, ID3_ARTIST[newv]) == 0)
      strncpy ((char *)mp3_file->artist, decoded_text, MIN(length, 63));
    else if (strcmp (identifier, ID3_ALBUM[newv]) == 0)
      strncpy ((char *)mp3_file->album, decoded_text, MIN(length, 63));
  }

  return 0;
}

int parse_id3v1 (unsigned char tag_data[128], rio_file_t *mp3_file) {
  char *tmp;

  if (strlen (mp3_file->title) == 0) {
    tmp = id3v1_string (&tag_data[3]);
    strncpy (mp3_file->title, tmp, strlen (tmp));
  }

  if (strlen (mp3_file->artist) == 0) {
    tmp = id3v1_string (&tag_data[33]);
    strncpy (mp3_file->artist, tmp, strlen (tmp));
  }

  if (strlen (mp3_file->album) == 0) {
    tmp = id3v1_string (&tag_data[63]);
    strncpy (mp3_file->album, tmp, strlen (tmp));
  }

  if (strlen ((char *)mp3_file->genre2) == 0) {
    if (tag_data[127] <= genre_count)
      strncpy ((char *)mp3_file->genre2, genre_table[tag_data[127]], strlen (genre_table[tag_data[127]]));
    else
      memmove (mp3_file->genre2, "Unknown\0", 8);
  }

  if (mp3_file->trackno2 == 0)
    if (tag_data[126] != 0xff)
      mp3_file->trackno2 = tag_data[126];

  return 0;
}

int get_id3_info (char *file_name, rio_file_t *mp3_file) {
  int tag_datalen = 0, id3_len = 0;
  unsigned char tag_data[128];
  int version;
  int id3v2_majorversion;
  int has_v2 = 0;
  FILE *fh;

  if ((fh = fopen (file_name, "r")) == NULL)
    return errno;

  /* built-in id3tag reading -- id3v2, id3v1 */
  if ((version = find_id3(2, fh, tag_data, &tag_datalen, &id3_len, &id3v2_majorversion)) != 0) {
    one_pass_parse_id3v2 (fh, tag_data, tag_datalen, id3v2_majorversion, mp3_file);
    has_v2 = 1;
  }

  /* some mp3's have both tags so check v1 even if v2 is available */
  if ((version = find_id3(1, fh, tag_data, &tag_datalen, NULL, &id3v2_majorversion)) != 0)
    parse_id3v1 (tag_data, mp3_file);
  
  /* Set the file descriptor at the end of the id3v2 header (if one exists) */
  fseek (fh, id3_len, SEEK_SET);
  
  if (strlen (mp3_file->title) == 0) {
    char *tfile_name = strdup (file_name);
    char *tmp = (char *)basename(tfile_name);
    int i;

    for (i = strlen(tmp) - 1 ; i > 0 ; i--)
      if (tmp[i] == '.') {
	tmp[i] = 0;
	break;
      }

    memmove (mp3_file->title, tmp, (strlen(tmp) > 63) ? 63 : strlen(tmp));
    free (tfile_name);
  }
 
  fclose (fh);
  
  return (has_v2) ? 2 : 1;
}
