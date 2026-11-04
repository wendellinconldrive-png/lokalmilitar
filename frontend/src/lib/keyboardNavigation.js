export const focusNextField = (currentField) => {
  const scope = currentField?.closest('[role="dialog"]') || document;
  const fields = Array.from(scope.querySelectorAll(
    'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"]',
  )).filter((field) => !field.readOnly);
  const currentIndex = fields.indexOf(currentField);
  const nextField = fields[currentIndex + 1];
  if (!nextField) return false;
  nextField.focus();
  return true;
};
