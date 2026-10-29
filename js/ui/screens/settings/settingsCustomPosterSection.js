import { ProfileManager } from "../../../core/profile/profileManager.js";
import { openCustomPosterPhoneConfig } from "./customPosterPhoneConfig.js";
import { Platform } from "../../../platform/index.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { CUSTOM_POSTER_SCREENS } from "../../../core/poster/customPoster.js";
import { I18n } from "../../../i18n/index.js";
const t = (key) => I18n.t(key);
export function renderCustomPosterSettings() {
  const settings = LayoutPreferences.get();
  const pid = ProfileManager.getActiveProfileId();
  const mount = this.settingsMountToken;
  const current = () =>
    this.isMounted &&
    this.activeSection === "layout" &&
    this.settingsMountToken === mount &&
    ProfileManager.getActiveProfileId() === pid;
  const phoneSupported = Platform.isWebOS() || Platform.isTizen();
  this.actionMap.set("layout:customPosterPhone", async () => {
    if (!current() || this.customPosterPhoneStarting) return;
    this.customPosterPhoneStarting = true;
    this.customPosterPhoneError = false;
    try {
      await openCustomPosterPhoneConfig(this);
    } catch (_) {
      if (current()) this.customPosterPhoneError = true;
    } finally {
      this.customPosterPhoneStarting = false;
    }
  });
  this.actionMap.set("layout:customPoster", () =>
    this.openTextDialog({
      title: t("layout_custom_poster_title"),
      value: settings.customPosterUrlPattern,
      placeholder: t("web_custom_poster_placeholder"),
      returnFocusKey: "layout:customPoster",
      clearLabel: t("layout_custom_poster_clear"),
      onClear: () => {
        if (!current()) return false;
        LayoutPreferences.set({
          customPosterUrlPattern: "",
          customPosterEnabledScreens: CUSTOM_POSTER_SCREENS
        });
      },
      onSubmit: (value) => {
        if (!current()) return false;
        if (value.trim() && !/^https?:\/\//i.test(value.trim())) return false;
        LayoutPreferences.set({ customPosterUrlPattern: value.trim() });
      }
    })
  );
  const screens = CUSTOM_POSTER_SCREENS.filter((screen) => screen !== "tv_recommendations");
  this.actionMap.set("layout:customPosterScreens", () =>
    this.openMultiChoiceDialog({
      title: t("layout_custom_poster_title"),
      options: screens.map((screen) => ({
        id: screen,
        label: t(`layout_custom_poster_screen_${screen}`)
      })),
      selectedIds: settings.customPosterEnabledScreens,
      returnFocusKey: "layout:customPosterScreens",
      onToggle: (keys) => current() && LayoutPreferences.set({ customPosterEnabledScreens: keys })
    })
  );
  const phoneMarkup = phoneSupported
    ? this.renderActionRow({
        focusKey: "layout:customPosterPhone",
        title: t("layout_custom_poster_qr"),
        subtitle: this.customPosterPhoneError
          ? t("web_custom_poster_error_connection")
          : t("custom_poster_qr_instruction")
      })
    : "";
  return (
    phoneMarkup +
    this.renderActionRow({
      focusKey: "layout:customPoster",
      title: t("layout_custom_poster_title"),
      subtitle: t("layout_custom_poster_description"),
      value: settings.customPosterUrlPattern ? t("layout_custom_poster_active") : ""
    }) +
    (settings.customPosterUrlPattern
      ? this.renderActionRow({
          focusKey: "layout:customPosterScreens",
          title: t("settings_card_depth_apply_to"),
          value: settings.customPosterEnabledScreens
            .filter((screen) => screens.includes(screen))
            .map((screen) => t(`layout_custom_poster_screen_${screen}`))
            .join(", ")
        })
      : "")
  );
}
