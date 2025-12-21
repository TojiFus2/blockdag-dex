import React from "react";
import cubeImg from "../assets/logo.png";

function prng01(seed) {
  const x = (seed * 9301 + 49297) % 233280;
  return x / 233280;
}

const cubes = [
  { x: "12%", y: "18%", size: "34px", opacity: 0.11, blur: "1px", rotate: "-10deg", dx: "70px", dy: "-40px", duration: "44s", rotateDuration: "30s", variant: "a" },
  { x: "22%", y: "72%", size: "64px", opacity: 0.09, blur: "2px", rotate: "8deg", dx: "-62px", dy: "44px", duration: "58s", rotateDuration: "36s", variant: "b" },
  { x: "35%", y: "28%", size: "48px", opacity: 0.13, blur: "0px", rotate: "14deg", dx: "54px", dy: "58px", duration: "46s", rotateDuration: "40s", variant: "c" },
  { x: "44%", y: "62%", size: "92px", opacity: 0.07, blur: "4px", rotate: "-6deg", dx: "-46px", dy: "-62px", duration: "60s", rotateDuration: "48s", variant: "a" },
  { x: "56%", y: "14%", size: "72px", opacity: 0.1, blur: "1px", rotate: "6deg", dx: "76px", dy: "38px", duration: "52s", rotateDuration: "34s", variant: "b" },
  { x: "68%", y: "44%", size: "120px", opacity: 0.06, blur: "6px", rotate: "-12deg", dx: "-78px", dy: "46px", duration: "56s", rotateDuration: "54s", variant: "c" },
  { x: "78%", y: "76%", size: "54px", opacity: 0.12, blur: "0px", rotate: "10deg", dx: "58px", dy: "-52px", duration: "38s", rotateDuration: "28s", variant: "a" },
  { x: "88%", y: "22%", size: "38px", opacity: 0.14, blur: "1px", rotate: "-4deg", dx: "-44px", dy: "34px", duration: "42s", rotateDuration: "32s", variant: "b" },

  { x: "6%", y: "40%", size: "160px", opacity: 0.05, blur: "6px", rotate: "12deg", dx: "88px", dy: "-56px", duration: "62s", rotateDuration: "60s", variant: "c" },
  { x: "16%", y: "90%", size: "44px", opacity: 0.1, blur: "2px", rotate: "-14deg", dx: "62px", dy: "-40px", duration: "50s", rotateDuration: "42s", variant: "a" },
  { x: "28%", y: "8%", size: "26px", opacity: 0.16, blur: "0px", rotate: "18deg", dx: "-38px", dy: "28px", duration: "36s", rotateDuration: "26s", variant: "b" },
  { x: "40%", y: "44%", size: "58px", opacity: 0.09, blur: "3px", rotate: "-2deg", dx: "-56px", dy: "64px", duration: "54s", rotateDuration: "44s", variant: "c" },
  { x: "52%", y: "84%", size: "36px", opacity: 0.12, blur: "1px", rotate: "2deg", dx: "52px", dy: "36px", duration: "40s", rotateDuration: "30s", variant: "a" },
  { x: "62%", y: "30%", size: "82px", opacity: 0.08, blur: "4px", rotate: "16deg", dx: "48px", dy: "-70px", duration: "58s", rotateDuration: "52s", variant: "b" },
  { x: "74%", y: "10%", size: "110px", opacity: 0.06, blur: "5px", rotate: "-16deg", dx: "-70px", dy: "48px", duration: "60s", rotateDuration: "56s", variant: "c" },
  { x: "92%", y: "56%", size: "66px", opacity: 0.09, blur: "2px", rotate: "4deg", dx: "-64px", dy: "-44px", duration: "48s", rotateDuration: "40s", variant: "a" },

  { x: "10%", y: "58%", size: "30px", opacity: 0.14, blur: "0px", rotate: "-18deg", dx: "42px", dy: "56px", duration: "34s", rotateDuration: "24s", variant: "b" },
  { x: "20%", y: "34%", size: "76px", opacity: 0.08, blur: "3px", rotate: "12deg", dx: "-58px", dy: "-48px", duration: "52s", rotateDuration: "46s", variant: "c" },
  { x: "32%", y: "86%", size: "112px", opacity: 0.05, blur: "6px", rotate: "-8deg", dx: "82px", dy: "-40px", duration: "64s", rotateDuration: "58s", variant: "a" },
  { x: "46%", y: "6%", size: "52px", opacity: 0.11, blur: "1px", rotate: "6deg", dx: "-46px", dy: "60px", duration: "44s", rotateDuration: "38s", variant: "b" },
  { x: "58%", y: "52%", size: "42px", opacity: 0.12, blur: "2px", rotate: "-10deg", dx: "60px", dy: "46px", duration: "46s", rotateDuration: "34s", variant: "c" },
  { x: "70%", y: "90%", size: "24px", opacity: 0.18, blur: "0px", rotate: "20deg", dx: "-36px", dy: "-30px", duration: "30s", rotateDuration: "22s", variant: "a" },
  { x: "84%", y: "38%", size: "96px", opacity: 0.06, blur: "5px", rotate: "-6deg", dx: "72px", dy: "-64px", duration: "62s", rotateDuration: "50s", variant: "b" },
  { x: "94%", y: "84%", size: "58px", opacity: 0.09, blur: "2px", rotate: "10deg", dx: "-58px", dy: "54px", duration: "50s", rotateDuration: "42s", variant: "c" }
];

export function BackgroundFX() {
  return (
    <div aria-hidden="true" className="bgfx">
      {cubes.map((cube, index) => {
        const r1 = prng01(index + 1);
        const r2 = prng01(index + 101);
        const r3 = prng01(index + 201);
        const r4 = prng01(index + 301);
        const r5 = prng01(index + 401);

        const isFloating = r1 < 0.5;
        const floatSign = r5 < 0.5 ? -1 : 1;
        const floatAmp = `${floatSign * (4 + Math.round(r2 * 10))}px`;
        const floatDuration = `${18 + Math.round(r3 * 37)}s`;
        const floatDelay = `${-Math.round(r4 * 34)}s`;

        return (
          <span
            key={index}
            className={`bgfx__cube bgfx__cube--${cube.variant}${isFloating ? " isFloating" : ""}`}
            style={{
              "--x": cube.x,
              "--y": cube.y,
              "--size": cube.size,
              "--o": cube.opacity,
              "--blur": cube.blur,
              "--rot": cube.rotate,
              "--dx": cube.dx,
              "--dy": cube.dy,
              "--dur": cube.duration,
              "--dur-rot": cube.rotateDuration,
              "--float-amp": floatAmp,
              "--float-dur": floatDuration,
              "--float-delay": floatDelay
            }}
          >
            <span className="bgfx__float">
              <span className="bgfx__cubeInner" style={{ backgroundImage: `url(${cubeImg})` }} />
            </span>
          </span>
        );
      })}
    </div>
  );
}
