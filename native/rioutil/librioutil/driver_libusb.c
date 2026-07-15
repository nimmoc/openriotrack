/**
 *   (c) 2002-2016 Nathan Hjelm <hjelmn@users.sourceforge.net>
 *   v1.5.3 driver_libusb.c
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
 *   You should have received a copy of the GNU Library Public License
 *   along with this program; if not, write to the Free Software
 *   Foundation, Inc., 675 Mass Ave, Cambridge, MA 02139, USA.
 **/

#include <stdlib.h>
#include <stdio.h>
#include <errno.h>

#include <libusb.h>

#include "driver.h"
#include "riolog.h"

char driver_method[] = "libusb";
static int usb_rio_open_count = 0;
static int usb_debug_level = 0;

static int usb_error_to_errno (int error_code) {
  switch (error_code) {
  case LIBUSB_ERROR_INVALID_PARAM:
    return -EINVAL;
  case LIBUSB_ERROR_ACCESS:
    return -EACCES;
  case LIBUSB_ERROR_NO_DEVICE:
    return -ENODEV;
  case LIBUSB_ERROR_NOT_FOUND:
    return -ENOENT;
  case LIBUSB_ERROR_BUSY:
    return -EBUSY;
  case LIBUSB_ERROR_TIMEOUT:
    return -ETIMEDOUT;
  case LIBUSB_ERROR_OVERFLOW:
    return -EOVERFLOW;
  case LIBUSB_ERROR_PIPE:
    return -EPIPE;
  case LIBUSB_ERROR_INTERRUPTED:
    return -EINTR;
  case LIBUSB_ERROR_NO_MEM:
    return -ENOMEM;
  case LIBUSB_ERROR_NOT_SUPPORTED:
    return -ENOTSUP;
  default:
    return -EIO;
  }
}

int usb_probe_rio (int number) {
  libusb_device **device_list = NULL;
  struct libusb_device_descriptor descriptor;
  struct player_device_info *p;
  int count, current = 0, found = 0, i, ret;

  if (number < 0)
    return -EINVAL;

  ret = libusb_init (NULL);
  if (LIBUSB_SUCCESS != ret)
    return usb_error_to_errno (ret);

  count = libusb_get_device_list (NULL, &device_list);
  if (count < 0) {
    libusb_exit (NULL);
    return usb_error_to_errno (count);
  }

  for (i = 0 ; i < count && !found ; i++) {
    if (libusb_get_device_descriptor (device_list[i], &descriptor) != LIBUSB_SUCCESS)
      continue;

    for (p = &player_devices[0] ; p->vendor_id ; p++) {
      if (descriptor.idVendor == p->vendor_id && descriptor.idProduct == p->product_id) {
        if (current++ == number)
          found = 1;
        break;
      }
    }
  }

  libusb_free_device_list (device_list, 1);
  libusb_exit (NULL);

  return found ? URIO_SUCCESS : -ENOENT;
}

int usb_open_rio (rios_t *rio, int number) {
  struct rioutil_usbdevice *plyr = NULL;

  libusb_device **device_list;
  struct libusb_device_descriptor descriptor;

  int configuration, current = 0, ret, i, count;
  int initialized_here = 0;
  struct player_device_info *p;
  struct player_device_info *matched_device = NULL;

  libusb_device *plyr_device = NULL;

  debug("librioutil/driver_libusb.c:usb_open_rio(rio=%p,number=%d)", (void *) rio, number);

  do {
    if (!usb_rio_open_count) {
      ret = libusb_init (NULL);
      if (LIBUSB_SUCCESS != ret)
        return usb_error_to_errno (ret);

      initialized_here = 1;

      if (usb_debug_level)
	libusb_set_option (NULL, LIBUSB_OPTION_LOG_LEVEL, usb_debug_level);
    }

    /* find a suitable device based on device table and player number */
    count = libusb_get_device_list (NULL, &device_list);
    if (0 > count) {
      error("librioutil/driver_libusb.c:usb_open_rio() error getting device list");
      ret = usb_error_to_errno (count);
      break;
    }

    for (i = 0 ; device_list[i] && !plyr_device ; ++i) {
      ret = libusb_get_device_descriptor (device_list[i], &descriptor);
      if (LIBUSB_SUCCESS != ret)
        continue;

      debug("USB Device: idVendor = %08x, idProduct = %08x", descriptor.idVendor, descriptor.idProduct);

      for (p = &player_devices[0] ; p->vendor_id && !plyr_device ; p++) {
        if (descriptor.idVendor == p->vendor_id && descriptor.idProduct == p->product_id &&
            current++ == number) {
          plyr_device = device_list[i];
          matched_device = p;
        }
      }

      /* found it */
      if (plyr_device) {
        /* reference this device so it isn't freed by libusb_free_device_list (, 1) */
        libusb_ref_device (plyr_device);
        break;
      }
    }

    /* have libusb unreference all devices */
    libusb_free_device_list (device_list, 1);

    if (plyr_device == NULL || matched_device == NULL) {
      ret = -ENOENT;
      break;
    }

    plyr = (struct rioutil_usbdevice *) calloc (1, sizeof (struct rioutil_usbdevice));
    if (plyr == NULL) {
      error("librioutil/driver_libusb.c:usb_open_rio() error allocating memory");
      ret = -ENOMEM;
      break;
    }

    plyr->entry = matched_device;

    /* open the device */
    ret = libusb_open (plyr_device, (libusb_device_handle **) &plyr->dev);
    if (LIBUSB_SUCCESS != ret) {
      error("librioutil/driver_libusb.c:usb_open_rio() error opening usb device: %s", libusb_error_name(ret));
      ret = usb_error_to_errno (ret);
      break;
    }

    /* we can release our reference to the device now */
    libusb_unref_device (plyr_device);
    plyr_device = NULL;

    ret = libusb_get_configuration ((libusb_device_handle *) plyr->dev, &configuration);
    if (LIBUSB_SUCCESS == ret && configuration != 1) {
      ret = libusb_set_configuration ((libusb_device_handle *) plyr->dev, 1);
      if (LIBUSB_SUCCESS != ret) {
        error("librioutil/driver_libusb.c:usb_open_rio() error setting configuration: %s", libusb_error_name(ret));
        ret = usb_error_to_errno (ret);
        break;
      }
    }

    ret = libusb_claim_interface ((libusb_device_handle *) plyr->dev, 0);
    if (LIBUSB_SUCCESS != ret) {
      error("librioutil/driver_libusb.c:usb_open_rio() error claiming interface 0: %s", libusb_error_name(ret));
      ret = usb_error_to_errno (ret);
      break;
    }

    rio->dev    = (void *)plyr;
    usb_rio_open_count++;

    debug("librioutil/driver_libusb.c:usb_open_rio() Success");

    return 0;
  } while (0);

  if (plyr_device) {
    libusb_unref_device (plyr_device);
  }

  if (plyr) {
    if (plyr->dev)
      libusb_close ((libusb_device_handle *) plyr->dev);
    free (plyr);
  }

  if (initialized_here)
    libusb_exit (NULL);

  return ret;
}

void usb_close_rio (rios_t *rio) {
  struct rioutil_usbdevice *dev = (struct rioutil_usbdevice *)rio->dev;

  if (NULL == dev) {
    return;
  }

  if (dev->dev) {
    (void) libusb_release_interface ((libusb_device_handle *) dev->dev, 0);
    (void) libusb_close ((libusb_device_handle *) dev->dev);
  }

  free (dev);

  rio->dev = NULL;

  if (!--usb_rio_open_count) {
    libusb_exit (NULL);
  }
}

/* direction is unused  here */
int control_msg(rios_t *rio, u_int8_t request, u_int16_t value,
		u_int16_t index, u_int16_t length, unsigned char *buffer) {
  struct rioutil_usbdevice *dev = (struct rioutil_usbdevice *) rio->dev;

  unsigned char requesttype = 0;
  int ret;

  requesttype = 0x80 | LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_DEVICE;

  ret = libusb_control_transfer ((libusb_device_handle *) dev->dev, requesttype, request, value,
                                 index, buffer, length, 15000);
  if (length == ret) {
    return URIO_SUCCESS;
  }

  if (ret < 0) {
    error("librioutil/driver_libusb.c:control_msg() request 0x%02x failed: %s",
          request, libusb_error_name (ret));
    return usb_error_to_errno (ret);
  }

  error("librioutil/driver_libusb.c:control_msg() request 0x%02x returned %d of %u bytes",
        request, ret, length);
  return -EIO;
}

int write_bulk(rios_t *rio, unsigned char *buffer, u_int32_t buffer_size) {
  struct rioutil_usbdevice *dev = (struct rioutil_usbdevice *)rio->dev;

  int ret, transferred = 0;

  ret = libusb_bulk_transfer ((libusb_device_handle *) dev->dev, dev->entry->oep,
                              buffer, buffer_size, &transferred, 8000);
  if (LIBUSB_SUCCESS != ret) {
    error("librioutil/driver_libusb.c:write_bulk() failed: %s; transferred %d of %u bytes",
          libusb_error_name (ret), transferred, buffer_size);
    return usb_error_to_errno (ret);
  }

  return transferred;
}

int read_bulk(rios_t *rio, unsigned char *buffer, u_int32_t buffer_size){
  struct rioutil_usbdevice *dev = (struct rioutil_usbdevice *)rio->dev;

  int ret, transferred = 0;

  ret = libusb_bulk_transfer ((libusb_device_handle *) dev->dev, dev->entry->iep | 0x80,
                              buffer, buffer_size, &transferred, 8000);
  if (LIBUSB_SUCCESS != ret) {
    error("librioutil/driver_libusb.c:read_bulk() failed: %s; transferred %d of %u bytes",
          libusb_error_name (ret), transferred, buffer_size);
    return usb_error_to_errno (ret);
  }
  
  return transferred;
}

void usb_setdebug (int i) {
  usb_debug_level = i;
}
