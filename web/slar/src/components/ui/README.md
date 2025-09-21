# UI Components

This directory contains reusable UI components for the SLAR application.

## Modal Component

A flexible and reusable modal component built with @headlessui/react, similar to the structure used in EscalationPolicyModal.

### Basic Usage

```jsx
import { Modal, ModalFooter, ModalButton } from '../ui';

function MyComponent() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      title="My Modal Title"
      size="lg"
    >
      <p>Modal content goes here...</p>
    </Modal>
  );
}
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | boolean | - | Whether the modal is open |
| `onClose` | function | - | Function to call when modal should close |
| `title` | string | - | Modal title |
| `children` | ReactNode | - | Modal content |
| `size` | string | 'lg' | Modal size ('sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', 'full') |
| `showCloseButton` | boolean | true | Whether to show the close button |
| `closeOnOverlayClick` | boolean | true | Whether clicking overlay closes modal |
| `className` | string | '' | Additional CSS classes for the modal panel |
| `footer` | ReactNode | - | Optional footer content |
| `scrollable` | boolean | true | Whether the modal content should be scrollable |
| `maxHeight` | string | 'calc(90vh-180px)' | Maximum height for scrollable content |

### Modal with Footer

```jsx
import { Modal, ModalFooter, ModalButton } from '../ui';

function ModalWithFooter() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    // Perform save operation
    await saveData();
    setLoading(false);
    setIsOpen(false);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      title="Edit Item"
      footer={
        <ModalFooter>
          <ModalButton variant="secondary" onClick={() => setIsOpen(false)}>
            Cancel
          </ModalButton>
          <ModalButton 
            variant="primary" 
            onClick={handleSave}
            loading={loading}
          >
            Save Changes
          </ModalButton>
        </ModalFooter>
      }
    >
      <form>
        {/* Form content */}
      </form>
    </Modal>
  );
}
```

### ModalButton Variants

The `ModalButton` component supports different variants:

- `primary` - Blue button (default)
- `secondary` - Gray/white button
- `success` - Green button
- `danger` - Red button
- `warning` - Yellow button

```jsx
<ModalButton variant="danger" onClick={handleDelete}>
  Delete Item
</ModalButton>
```

### Pre-built Modal Components

#### ConfirmationModal

A pre-built modal for confirmation dialogs:

```jsx
import { ConfirmationModal } from '../ui';

function DeleteConfirmation() {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleDelete = async () => {
    // Perform delete operation
    await deleteItem();
    setShowConfirm(false);
  };

  return (
    <ConfirmationModal
      isOpen={showConfirm}
      onClose={() => setShowConfirm(false)}
      onConfirm={handleDelete}
      title="Delete Item"
      message="Are you sure you want to delete this item? This action cannot be undone."
      confirmText="Delete"
      cancelText="Cancel"
      variant="danger"
    />
  );
}
```

#### LoadingModal

A pre-built modal for loading states:

```jsx
import { LoadingModal } from '../ui';

function MyComponent() {
  const [isLoading, setIsLoading] = useState(false);

  return (
    <LoadingModal
      isOpen={isLoading}
      title="Processing..."
      message="Please wait while we save your changes."
    />
  );
}
```

### Advanced Usage

#### Large Modal with Scrollable Content

```jsx
<Modal
  isOpen={isOpen}
  onClose={onClose}
  title="Large Data View"
  size="4xl"
  scrollable={true}
  maxHeight="calc(80vh-100px)"
>
  <div className="space-y-4">
    {/* Large amount of content */}
  </div>
</Modal>
```

#### Modal without Close Button

```jsx
<Modal
  isOpen={isOpen}
  onClose={onClose}
  title="Required Action"
  showCloseButton={false}
  closeOnOverlayClick={false}
>
  <p>You must complete this action before continuing.</p>
</Modal>
```

### Styling

The modal components use Tailwind CSS classes and support dark mode. The modal automatically adapts to the current theme (light/dark).

### Accessibility

The modal component is built with accessibility in mind:

- Uses proper ARIA attributes
- Supports keyboard navigation
- Focus management
- Screen reader support through @headlessui/react

## Toast Component

For toast notifications, see the existing Toast component documentation.

### Usage with Modal

```jsx
import { Modal, ModalButton, toast } from '../ui';

function MyModal() {
  const handleSave = async () => {
    try {
      await saveData();
      toast.success('Data saved successfully!');
      onClose();
    } catch (error) {
      toast.error('Failed to save data');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Save Data">
      {/* Modal content */}
    </Modal>
  );
}
```