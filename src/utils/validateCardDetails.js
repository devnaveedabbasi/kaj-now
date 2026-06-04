// Card validation helper functions
const validateCardNumber = (cardNumber) => {
  // Remove spaces and dashes
  const cleaned = cardNumber.replace(/[\s-]/g, '');

  // Check length (13-19 digits)
  if (cleaned.length < 13 || cleaned.length > 19) {
    return { isValid: false, message: 'Card number must be between 13-19 digits' };
  }

  // Check if only numbers
  if (!/^\d+$/.test(cleaned)) {
    return { isValid: false, message: 'Card number must contain only digits' };
  }

  // Luhn algorithm (basic card validation)
  let sum = 0;
  let isEven = false;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    let digit = parseInt(cleaned.charAt(i), 10);
    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    isEven = !isEven;
  }

  if (sum % 10 !== 0) {
    return { isValid: false, message: 'Invalid card number' };
  }

  // Detect card type
  let cardType = 'unknown';
  if (/^4/.test(cleaned)) cardType = 'visa';
  else if (/^5[1-5]/.test(cleaned)) cardType = 'mastercard';
  else if (/^3[47]/.test(cleaned)) cardType = 'amex';
  else if (/^6(?:011|5)/.test(cleaned)) cardType = 'discover';

  return { isValid: true, cardType, cleaned };
};

const validateExpiryDate = (expiryDate) => {
  // Check format MM/YY or MM/YYYY
  const patterns = [
    /^(0[1-9]|1[0-2])\/(\d{2})$/,
    /^(0[1-9]|1[0-2])\/(\d{4})$/
  ];

  let match = null;
  for (const pattern of patterns) {
    match = expiryDate.match(pattern);
    if (match) break;
  }

  if (!match) {
    return { isValid: false, message: 'Invalid expiry date format. Use MM/YY or MM/YYYY' };
  }

  const month = parseInt(match[1], 10);
  let year = parseInt(match[2], 10);

  // Convert 2-digit year to 4-digit
  if (year < 100) year += 2000;

  // Check month range
  if (month < 1 || month > 12) {
    return { isValid: false, message: 'Invalid month' };
  }

  // Check if card is expired
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return { isValid: false, message: 'Card has expired' };
  }

  // Check if expiry is too far (max 10 years)
  if (year > currentYear + 10) {
    return { isValid: false, message: 'Invalid expiry date' };
  }

  return { isValid: true, month, year };
};

const validateCVV = (cvv, cardType = null) => {
  // Remove spaces
  const cleaned = cvv.replace(/\s/g, '');

  // Check if only numbers
  if (!/^\d+$/.test(cleaned)) {
    return { isValid: false, message: 'CVV must contain only digits' };
  }

  // Amex has 4-digit CVV, others have 3-digit
  const expectedLength = cardType === 'amex' ? 4 : 3;

  if (cleaned.length !== expectedLength) {
    return {
      isValid: false,
      message: `CVV must be ${expectedLength} digits for ${cardType === 'amex' ? 'American Express' : 'this card type'}`
    };
  }

  return { isValid: true, cvv: cleaned };
};

const validateCardHolderName = (name) => {
  if (!name || name.trim().length < 3) {
    return { isValid: false, message: 'Card holder name is required (min 3 characters)' };
  }

  if (name.trim().length > 50) {
    return { isValid: false, message: 'Card holder name is too long' };
  }

  // Allow letters, spaces, dots, and hyphens
  if (!/^[a-zA-Z\s\.\-]+$/.test(name.trim())) {
    return { isValid: false, message: 'Invalid card holder name' };
  }

  return { isValid: true, name: name.trim() };
};

// Main validation function
export const validateCardDetails = (cardDetails) => {
  const errors = [];

  // Check if cardDetails exists
  if (!cardDetails) {
    throw new ApiError(400, 'Card details are required');
  }

  // Validate card number
  const cardNumberValidation = validateCardNumber(cardDetails.cardNumber);
  if (!cardNumberValidation.isValid) {
    errors.push(cardNumberValidation.message);
  }

  // Validate expiry date
  const expiryValidation = validateExpiryDate(cardDetails.expiryDate);
  if (!expiryValidation.isValid) {
    errors.push(expiryValidation.message);
  }

  // Validate CVV (with card type from card number validation)
  const cvvValidation = validateCVV(cardDetails.cvv, cardNumberValidation.cardType);
  if (!cvvValidation.isValid) {
    errors.push(cvvValidation.message);
  }

  // Validate card holder name
  const nameValidation = validateCardHolderName(cardDetails.cardHolderName);
  if (!nameValidation.isValid) {
    errors.push(nameValidation.message);
  }

  if (errors.length > 0) {
    throw new ApiError(400, errors.join('. '));
  }

  return {
    isValid: true,
    cardNumber: cardNumberValidation.cleaned,
    cardType: cardNumberValidation.cardType,
    expiryMonth: expiryValidation.month,
    expiryYear: expiryValidation.year,
    cvv: cvvValidation.cvv,
    cardHolderName: nameValidation.name
  };
};