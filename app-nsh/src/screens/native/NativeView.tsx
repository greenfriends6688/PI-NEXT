// A platform's own view, built in TypeScript and laid out by NSH like any other
// element: AppKit's `NSSlider` on macOS, UIKit's `UISlider` on iOS, Android's
// `SeekBar` on Android. The same component, the platform's own control.
//
// This needs the NativeScript bridge (`crates/nsh-ns`, from
// https://github.com/nstudio/native-shell-with-ns): it installs NativeScript in
// NSH's VM, which is what makes `NSSlider` and friends exist as globals. An app
// run by plain `nsh run` has no bridge, so `nativeAvailable()` is false there
// and the caller falls back to an NSH control.
import { effect, nativeComponent, platform, signal } from "nsh";

declare const NSValue: any, interop: any, android: any, dev: any, NSSlider: any, NSSwitch: any, UISlider: any, UISwitch: any;

/** Whether this build can reach the platform's own classes (the bridge is in). */
export function nativeAvailable(): boolean {
  return typeof NSValue !== "undefined" || typeof android !== "undefined";
}

const Host = nativeComponent<{}, { ready: { handle: number } }>("ns.view", {
  props: [],
  events: ["ready"],
});

/** Puts `view` inside the host the bridge made for us, sized to it. */
function attach(handle: number, view: any) {
  if (typeof NSValue !== "undefined") {
    // `new NSView(pointer)` over-releases the view; an object returned from a
    // method is retained normally.
    const host = NSValue.valueWithPointer(new interop.Pointer(handle)).nonretainedObjectValue;
    view.frame = host.bounds;
    // Width and height sizable; the same bits in AppKit and UIKit.
    view.autoresizingMask = 2 | 16;
    host.addSubview(view);
  } else {
    const matchParent = android.view.ViewGroup.LayoutParams.MATCH_PARENT;
    dev.nstudio.nshns.NsBridge.hostView(handle).addView(
      view,
      new android.widget.FrameLayout.LayoutParams(matchParent, matchParent),
    );
  }
}

/** One platform view, created by `create` and updated by `update`. */
export function NativeView<V>(props: { create: () => V; update?: (view: V) => void; style?: any }) {
  const view = signal<V | undefined>(undefined);
  effect(() => {
    const current = view();
    if (current !== undefined) props.update?.(current);
  });
  return (
    <Host
      style={props.style}
      onReady={({ handle }) => {
        const made = props.create();
        attach(handle, made);
        view.set(made);
      }}
    />
  );
}

/** The platform's slider class, or `null` where the bridge is absent. */
export function makeSlider(onChange: (value: number) => void): any {
  if (typeof NSSlider !== "undefined") {
    const slider = NSSlider.new();
    slider.minValue = 0;
    slider.maxValue = 100;
    slider.target = target(onChange, (sender: any) => Math.round(sender.doubleValue));
    return slider;
  }
  if (typeof UISlider !== "undefined") {
    const slider = UISlider.new();
    slider.minimumValue = 0;
    slider.maximumValue = 100;
    slider.addTargetActionForControlEvents(
      target(onChange, (sender: any) => Math.round(sender.value)),
      "changed:",
      1 << 12, // UIControl.Event.valueChanged
    );
    return slider;
  }
  if (typeof android !== "undefined") {
    const activity = (dev as any).nstudio.nshns.NsBridge.activity();
    const seek = new android.widget.SeekBar(activity);
    seek.setMax(100);
    seek.setOnSeekBarChangeListener(
      new android.widget.SeekBar.OnSeekBarChangeListener({
        onProgressChanged: (_bar: any, progress: number) => onChange(progress),
        onStartTrackingTouch: () => {},
        onStopTrackingTouch: () => {},
      }),
    );
    return seek;
  }
  return null;
}

/** Sets a slider made by `makeSlider` to `value`. */
export function setSlider(slider: any, value: number): void {
  if (slider === null || slider === undefined) return;
  if (typeof NSSlider !== "undefined" && slider.doubleValue !== undefined) {
    slider.doubleValue = value;
  } else if (typeof UISlider !== "undefined" && slider.value !== undefined) {
    slider.value = value;
  } else if (typeof android !== "undefined" && typeof slider.setProgress === "function") {
    slider.setProgress(value);
  }
}

/**
 * Native controls hold their targets weakly, so JS has to keep them alive.
 * One `NativeClass` subclass per platform's action shape, made per callback.
 */
const targets = new WeakMap<object, unknown>();

function target(onChange: (value: number) => void, read: (sender: any) => number): any {
  const NativeClass = (globalThis as any).NativeClass;
  const NSObject = (globalThis as any).NSObject;
  const mk = (): any => {
    const Klass = class extends NSObject {
      static ObjCExposedMethods = {
        "changed:": { params: [interop.types.id], returns: interop.types.void },
      };
      changed(sender: any) {
        onChange(read(sender));
      }
    };
    // `static { NativeClass(this) }` in the showcase; done here so one file
    // serves every platform.
    NativeClass(Klass);
    return Klass.new();
  };
  const made = mk();
  targets.set(made, made);
  return made;
}

/** The platform's switch class, or `null` where the bridge is absent. */
export function makeSwitch(onChange: (value: boolean) => void): any {
  if (typeof NSSwitch !== "undefined") {
    const control = NSSwitch.new();
    control.target = target(() => onChange(control.state === 1), (sender: any) => (sender.state === 1 ? 1 : 0));
    return control;
  }
  if (typeof UISwitch !== "undefined") {
    const control = UISwitch.new();
    control.addTargetActionForControlEvents(
      target(() => onChange(control.isOn), (sender: any) => (sender.isOn ? 1 : 0)),
      "changed:",
      1 << 12,
    );
    return control;
  }
  if (typeof android !== "undefined") {
    const activity = (dev as any).nstudio.nshns.NsBridge.activity();
    const control = new android.widget.Switch(activity);
    control.setOnCheckedChangeListener(
      new android.widget.CompoundButton.OnCheckedChangeListener({
        onCheckedChanged: (_button: any, checked: boolean) => onChange(checked),
      }),
    );
    return control;
  }
  return null;
}

/** Sets a switch made by `makeSwitch`. */
export function setSwitch(control: any, value: boolean): void {
  if (control === null || control === undefined) return;
  if (typeof NSSwitch !== "undefined" && control.state !== undefined) {
    control.state = value ? 1 : 0;
  } else if (typeof UISwitch !== "undefined" && control.isOn !== undefined) {
    control.isOn = value;
  } else if (typeof android !== "undefined" && typeof control.setChecked === "function") {
    control.setChecked(value);
  }
}
