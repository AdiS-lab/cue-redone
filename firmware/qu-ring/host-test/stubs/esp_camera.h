// Field and enum names as published in espressif/esp32-camera driver/include/esp_camera.h
#pragma once
#include <cstddef>
#include <cstdint>
typedef int esp_err_t;
#define ESP_OK 0
typedef enum { LEDC_CHANNEL_0 } ledc_channel_t;
typedef enum { LEDC_TIMER_0 } ledc_timer_t;
typedef enum { PIXFORMAT_JPEG } pixformat_t;
typedef enum { FRAMESIZE_SVGA, FRAMESIZE_XGA, FRAMESIZE_SXGA } framesize_t;
typedef enum { CAMERA_GRAB_WHEN_EMPTY, CAMERA_GRAB_LATEST } camera_grab_mode_t;
typedef enum { CAMERA_FB_IN_PSRAM, CAMERA_FB_IN_DRAM } camera_fb_location_t;
typedef struct {
  int pin_pwdn, pin_reset, pin_xclk, pin_sccb_sda, pin_sccb_scl;
  int pin_d7, pin_d6, pin_d5, pin_d4, pin_d3, pin_d2, pin_d1, pin_d0;
  int pin_vsync, pin_href, pin_pclk;
  int xclk_freq_hz;
  ledc_timer_t ledc_timer;
  ledc_channel_t ledc_channel;
  pixformat_t pixel_format;
  framesize_t frame_size;
  int jpeg_quality;
  size_t fb_count;
  camera_fb_location_t fb_location;
  camera_grab_mode_t grab_mode;
  int sccb_i2c_port;
  size_t jpeg_buffer_size;
} camera_config_t;
typedef struct { uint8_t *buf; size_t len; size_t width; size_t height; } camera_fb_t;
typedef struct sensor_t sensor_t;
struct sensor_t {
  int (*set_whitebal)(sensor_t *, int);
  int (*set_gain_ctrl)(sensor_t *, int);
  int (*set_exposure_ctrl)(sensor_t *, int);
  int (*set_lenc)(sensor_t *, int);
};
esp_err_t esp_camera_init(const camera_config_t *config);
camera_fb_t *esp_camera_fb_get(void);
void esp_camera_fb_return(camera_fb_t *fb);
sensor_t *esp_camera_sensor_get(void);
