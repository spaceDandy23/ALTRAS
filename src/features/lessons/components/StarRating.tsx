export function StarRating({ count, label = true }: { count: number; label?: boolean }) {
  return (
    <span className="star-rating" aria-label={label ? `${count} out of 3 stars` : undefined}>
      {[1, 2, 3].map((star) => (
        <span key={star} className={star <= count ? 'star-rating__earned' : ''} aria-hidden="true">
          ★
        </span>
      ))}
    </span>
  );
}
