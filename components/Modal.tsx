import React from "react";
import { Modal as PPMOdal, Portal, Text } from "react-native-paper";
export default function Modal() {
  const [visible, setVisible] = React.useState(false);

  const showModal = () => setVisible(true);
  const hideModal = () => setVisible(false);
  const containerStyle = { backgroundColor: 'white', padding: 20 };

  return (
    <PPMOdal visible={visible} onDismiss={hideModal} contentContainerStyle={containerStyle}>
      <Text>Example Modal.  Click outside this area to dismiss.</Text>
    </PPMOdal>
  )
}
