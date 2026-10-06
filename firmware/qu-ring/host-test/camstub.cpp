#include "esp_camera.h"
esp_err_t esp_camera_init(const camera_config_t *) { return 0; }
camera_fb_t *esp_camera_fb_get(void) { return nullptr; }
void esp_camera_fb_return(camera_fb_t *) {}
sensor_t *esp_camera_sensor_get(void) { return nullptr; }
