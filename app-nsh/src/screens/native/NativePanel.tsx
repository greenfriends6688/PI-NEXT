// Settings › Native: each platform's own view, in NSH's layout.
//
// macOS draws AppKit's `NSSlider` and `NSSwitch`, iOS UIKit's `UISlider` and
// `UISwitch`, Android `SeekBar` and `Switch` — the same component, the
// platform's real control, bound to a signal both ways. It needs the
// NativeScript bridge (`crates/nsh-ns`): under plain `nsh run` the classes do
// not exist, so the panel says so and shows an NSH slider with the same value
// instead of pretending.
import { Text, View } from "nsh";
import { Slider, Switch } from "nsh/base";
import { Caption, colors, density, Row, Section } from "../../ui/kit";
import { t } from "../../ui/i18n";
import { sans } from "../../ui/fonts";
import { signal } from "nsh";
import { NativeView, makeSlider, makeSwitch, nativeAvailable, setSlider, setSwitch } from "./NativeView";

/** The two values the native controls drive. */
const level = signal(40);
const enabled = signal(true);

export function NativePanel() {
  const available = nativeAvailable();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, ...sansStyle }}>
      <Section title={t("native.title")} note={t("native.detail")}>
        <Row>
          <Caption
            label={<Text style={{ fontSize: density.body, color: colors.text }}>{t("native.bridge")}</Text>}
            note={available ? t("native.bridgeOn") : t("native.bridgeOff")}
          />
        </Row>

        {/* The platform's slider, laid out like any element and two-way bound. */}
        <Row>
          <Caption label={<Text style={{ fontSize: density.body, color: colors.text }}>{t("native.slider")}</Text>} note={t("native.sliderDetail", { value: level() })} />
          <View style={{ width: 220, height: 28, justifyContent: "center" }}>
            <If when={available} else={<FallbackSlider />}>
              <NativeView
                style={{ height: 28 }}
                create={() => makeSlider((value) => level.set(value))}
                update={(slider) => setSlider(slider, level())}
              />
            </If>
          </View>
        </Row>

        {/* A native switch where the platform has one; NSH's elsewhere. */}
        <Row>
          <Caption label={<Text style={{ fontSize: density.body, color: colors.text }}>{t("native.switch")}</Text>} note={t("native.switchDetail")} />
          <If when={available} else={<FallbackSwitch />}>
            <View style={{ width: 44, height: 28, justifyContent: "center" }}>
              <NativeView
                style={{ height: 28 }}
                create={() => makeSwitch((value) => enabled.set(value))}
                update={(control) => setSwitch(control, enabled())}
              />
            </View>
          </If>
        </Row>

        <Row>
          <Caption label={<Text style={{ fontSize: density.body, color: colors.text }}>{t("native.value")}</Text>} note={`${level()}`} />
        </Row>
      </Section>
    </View>
  );
}

/** NSH's own slider, so the panel still reads as a control without the bridge. */
function FallbackSlider() {
  return (
    <Slider
      value={level()}
      min={0}
      max={100}
      onChange={({ value }) => level.set(Math.round(typeof value === "number" ? value : value[0]))}
      accessibilityLabel={t("native.slider")}
      trackClass="h-1 rounded-full bg-secondary"
      indicatorClass="h-1 rounded-full bg-primary"
      thumbClass="size-4 rounded-full bg-card border border-border"
    />
  );
}

function FallbackSwitch() {
  return (
    <Switch
      checked={enabled()}
      onChange={({ checked }) => enabled.set(checked)}
      accessibilityLabel={t("native.switch")}
      trackClass="w-10 h-6 rounded-full bg-secondary checked:bg-primary"
      thumbClass="size-5 rounded-full bg-card"
    />
  );
}

const sansStyle = { fontFamily: sans };
