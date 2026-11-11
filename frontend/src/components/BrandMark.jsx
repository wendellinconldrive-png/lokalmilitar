import React from "react";

export default function BrandMark({ align = "left", compact = false, light = false }) {
  const titleSize = compact ? 32 : 22;
  const subtitleSize = compact ? 9 : 10;
  const titleStyle = {
    fontFamily: "'Black Ops One', 'Saira Stencil One', sans-serif",
    fontSize: titleSize,
    lineHeight: 1,
    letterSpacing: "0.04em",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ textAlign: align, display: "inline-block" }} aria-label="LOKAL MILITAR — UM NOVO CONCEITO">
      <div style={titleStyle}>
        <span style={{ color: light ? "#333333" : "#C3B091" }}>LOKAL</span>{" "}
        <span style={{ color: "#B8860B" }}>MILITAR</span>
      </div>
      <div style={{
        color: light ? "#555555" : "#C3B091",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: subtitleSize,
        lineHeight: 1.4,
        letterSpacing: "normal",
        marginTop: 5,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        width: "100%",
        textAlign: align,
      }}>
        UM NOVO CONCEITO
      </div>
    </div>
  );
}
