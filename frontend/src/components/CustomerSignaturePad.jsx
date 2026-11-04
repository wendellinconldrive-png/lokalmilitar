import React, { useEffect, useRef } from "react";

export default function CustomerSignaturePad({
  initialValue,
  onChange,
  label = "Assinatura do cliente",
  testid = "customer-signature-pad",
  clearTestid = "clear-customer-signature",
}) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!initialValue) return;
    const image = new Image();
    image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = initialValue;
  }, [initialValue]);

  const point = (event) => {
    const canvas = canvasRef.current;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * canvas.width / bounds.width,
      y: (event.clientY - bounds.top) * canvas.height / bounds.height,
    };
  };

  const start = (event) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    canvas.setPointerCapture(event.pointerId);
    drawing.current = true;
    const context = canvas.getContext("2d");
    const { x, y } = point(event);
    context.beginPath();
    context.moveTo(x, y);
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.strokeStyle = "#111111";
  };

  const draw = (event) => {
    if (!drawing.current) return;
    event.preventDefault();
    const context = canvasRef.current.getContext("2d");
    const { x, y } = point(event);
    context.lineTo(x, y);
    context.stroke();
  };

  const stop = () => {
    if (drawing.current) onChange(canvasRef.current.toDataURL("image/png"));
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  };

  return (
    <div className="space-y-2">
      <p className="text-sm">{label}</p>
      <canvas
        ref={canvasRef}
        width={900}
        height={240}
        className="w-full h-32 border rounded bg-white touch-none"
        onPointerDown={start}
        onPointerMove={draw}
        onPointerUp={stop}
        onPointerCancel={stop}
        aria-label={`Campo para ${label.toLocaleLowerCase()}`}
        data-testid={testid}
      />
      <button type="button" className="lm-btn lm-btn-outline" onClick={clear} data-testid={clearTestid}>Limpar assinatura</button>
    </div>
  );
}
