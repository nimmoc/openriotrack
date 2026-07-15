#import <AppKit/AppKit.h>

#include <string.h>

#include "rioi.h"

static int render_rio800_title_bitmap_once (
  const char *title,
  u_int8_t pixels[RIO800_TITLE_BITMAP_HEIGHT][RIO800_TITLE_BITMAP_WIDTH]
) {
  int x, y;

  if (title == NULL || title[0] == '\0' || pixels == NULL)
    return -1;

  @autoreleasepool {
    NSString *text = [NSString stringWithUTF8String:title];
    NSBitmapImageRep *bitmap;
    NSGraphicsContext *context;
    NSFont *font;
    NSDictionary *attributes;

    if (text == nil)
      return -1;

    bitmap = [[NSBitmapImageRep alloc]
      initWithBitmapDataPlanes:NULL
                    pixelsWide:RIO800_TITLE_BITMAP_WIDTH
                    pixelsHigh:RIO800_TITLE_BITMAP_HEIGHT
                 bitsPerSample:8
               samplesPerPixel:1
                      hasAlpha:NO
                      isPlanar:NO
                colorSpaceName:NSDeviceWhiteColorSpace
                   bytesPerRow:RIO800_TITLE_BITMAP_WIDTH
                  bitsPerPixel:8];
    if (bitmap == nil)
      return -1;

    context = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
    if (context == nil) {
      [bitmap release];
      return -1;
    }

    [NSGraphicsContext saveGraphicsState];
    [NSGraphicsContext setCurrentContext:context];
    [context setShouldAntialias:NO];
    CGContextSetShouldAntialias([context CGContext], false);
    CGContextSetAllowsAntialiasing([context CGContext], false);
    [[NSColor whiteColor] setFill];
    NSRectFill(NSMakeRect(0, 0, RIO800_TITLE_BITMAP_WIDTH, RIO800_TITLE_BITMAP_HEIGHT));

    font = [NSFont fontWithName:@"PingFang SC" size:13.0];
    if (font == nil)
      font = [NSFont systemFontOfSize:13.0];
    attributes = @{
      NSFontAttributeName: font,
      NSForegroundColorAttributeName: [NSColor blackColor]
    };
    [text drawAtPoint:NSMakePoint(0, -3) withAttributes:attributes];
    [context flushGraphics];
    [NSGraphicsContext restoreGraphicsState];

    for (y = 0 ; y < RIO800_TITLE_BITMAP_HEIGHT ; y++) {
      int source_y = RIO800_TITLE_BITMAP_HEIGHT - 1 - y;
      for (x = 0 ; x < RIO800_TITLE_BITMAP_WIDTH ; x++) {
        NSColor *color = [bitmap colorAtX:x y:source_y];
        pixels[y][x] = color != nil && [color whiteComponent] < 0.5;
      }
    }

    [bitmap release];
  }

  return 0;
}

int rio_render_rio800_title_bitmap (
  const char *title,
  u_int8_t pixels[RIO800_TITLE_BITMAP_HEIGHT][RIO800_TITLE_BITMAP_WIDTH]
) {
  u_int8_t warmup[RIO800_TITLE_BITMAP_HEIGHT][RIO800_TITLE_BITMAP_WIDTH];

  if (render_rio800_title_bitmap_once (title, warmup) != 0)
    return -1;

  return render_rio800_title_bitmap_once (title, pixels);
}
