<?php
/**
 * Divine Printing - Quote Request Handler
 * Sends quote requests to chris@gardedev.com
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit;
}

// Sanitize inputs
function clean($val) {
    return htmlspecialchars(strip_tags(trim($val ?? '')));
}

$name     = clean($_POST['name'] ?? '');
$email    = clean($_POST['email'] ?? '');
$phone    = clean($_POST['phone'] ?? '');
$church   = clean($_POST['church'] ?? '');
$product  = clean($_POST['product'] ?? '');
$size     = clean($_POST['size'] ?? '');
$quantity = clean($_POST['quantity'] ?? '');
$timeline = clean($_POST['timeline'] ?? '');
$design   = clean($_POST['design'] ?? '');
$message  = clean($_POST['message'] ?? '');

// Validate required
if (empty($name) || empty($email) || empty($product)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Name, email, and product are required.']);
    exit;
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Invalid email address.']);
    exit;
}

$to      = 'chris@gardedev.com';
$subject = "✝ New Quote Request: {$product} — Divine Printing";

$body = "
==============================================
  DIVINE PRINTING — New Quote Request
==============================================

PRODUCT:   {$product}
DATE:      " . date('F j, Y \a\t g:i A T') . "

----------------------------------------------
CONTACT INFORMATION
----------------------------------------------
Name:         {$name}
Email:        {$email}
Phone:        {$phone}
Church/Org:   {$church}

----------------------------------------------
ORDER DETAILS
----------------------------------------------
Product:      {$product}
Size:         {$size}
Quantity:     {$quantity}
Timeline:     {$timeline}
Has Design:   {$design}

----------------------------------------------
ADDITIONAL NOTES
----------------------------------------------
{$message}

----------------------------------------------
Sent via divineprinting.com
==============================================
";

$headers  = "From: noreply@divineprinting.com\r\n";
$headers .= "Reply-To: {$email}\r\n";
$headers .= "X-Mailer: Divine Printing Website\r\n";
$headers .= "Content-Type: text/plain; charset=UTF-8\r\n";

$sent = mail($to, $subject, $body, $headers);

if ($sent) {
    // Send confirmation to customer
    $confirm_subject = "✝ We received your quote request — Divine Printing";
    $confirm_body = "
Dear {$name},

Thank you for reaching out to Divine Printing! We've received your quote request for:

  Product: {$product}
  Quantity: {$quantity}
  Timeline: {$timeline}

A member of our team will get back to you within 1 business day.

\"Go and make disciples of all nations.\" — Matthew 28:19

Blessings,
The Divine Printing Team
divineprinting.com
    ";
    $confirm_headers  = "From: hello@divineprinting.com\r\n";
    $confirm_headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
    mail($email, $confirm_subject, $confirm_body, $confirm_headers);

    echo json_encode(['success' => true, 'message' => 'Your quote request has been sent! We\'ll be in touch within 1 business day.']);
} else {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Sorry, there was an error sending your request. Please email us directly at chris@gardedev.com']);
}
